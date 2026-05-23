import { jest } from '@jest/globals';
import path from 'path';
import fs from 'fs/promises';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// 1. Mock bullmq and the background job runner to prevent Redis connection errors
jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(),
  })),
}));

jest.unstable_mockModule('../src/jobs/reconciliationQueue.js', () => ({
  reconciliationQueue: {
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    close: jest.fn().mockResolvedValue(),
  },
  queueReconciliationJob: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
}));

jest.unstable_mockModule('../src/jobs/reconciliationWorker.js', () => ({
  startReconciliationWorker: jest.fn(),
  default: jest.fn(),
}));

// Dynamically import tested modules to let the mocks load first
const validateTransactionRow = (await import('../src/ingestion/validators/transactionValidator.js')).default;
const normalizeTransactionRow = (await import('../src/ingestion/normalizers/transactionNormalizer.js')).default;
const calculateMatchScore = (await import('../src/matching/strategy/matchingStrategy.js')).calculateMatchScore;
const checkTypeAlignment = (await import('../src/matching/strategy/matchingStrategy.js')).checkTypeAlignment;
const { runReconciliation } = await import('../src/matching/services/reconciliationService.js');
const { generateReportsForRun } = await import('../src/reporting/reportService.js');
const Transaction = (await import('../src/models/transaction.js')).default;
const ReconciliationRun = (await import('../src/models/reconciliationRun.js')).default;
const ReconciliationReport = (await import('../src/models/reconciliationReport.js')).default;

describe('Transaction Reconciliation Engine Test Suite', () => {
  let mongoServer;
  let app;

  beforeAll(async () => {
    // Start in-memory database
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    process.env.MONGODB_URI = uri;

    await mongoose.connect(uri);

    // Sync schemas
    await Transaction.init();
    await ReconciliationRun.init();
    await ReconciliationReport.init();

    // Import app now that MONGODB_URI is set
    const appModule = await import('../src/app.js');
    app = appModule.default;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    // Clear collections between tests
    if (mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
  });

  // =========================================================================
  // SECTION 1: INGESTION, VALIDATION & NORMALIZATION
  // =========================================================================
  describe('1. Ingestion Validation & Normalization', () => {
    it('should validate row structures correctly and capture issues', () => {
      const processed = new Set();
      
      // Valid row
      const validRow = {
        transaction_id: 'TX100',
        timestamp: '2026-05-23T10:00:00Z',
        type: 'BUY',
        asset: 'BTC',
        quantity: '1.25',
        fee: '0.001'
      };
      const validRes = validateTransactionRow(validRow, processed);
      expect(validRes.valid).toBe(true);
      expect(validRes.issues.length).toBe(0);

      // Add to processed to test uniqueness
      processed.add('TX100');

      // Invalid row with multiple issues
      const invalidRow = {
        transaction_id: 'TX100', // duplicate
        timestamp: 'invalid-date', // bad timestamp
        type: 'SELL',
        asset: 'ETH',
        quantity: '-2.5', // negative qty
        fee: 'abc' // non-numeric fee
      };
      const invalidRes = validateTransactionRow(invalidRow, processed);
      expect(invalidRes.valid).toBe(false);
      expect(invalidRes.issues).toContain('Duplicate transaction ID within run: "TX100"');
      expect(invalidRes.issues).toContain('Invalid timestamp format: "invalid-date"');
      expect(invalidRes.issues).toContain('Quantity must be positive: "-2.5"');
      expect(invalidRes.issues).toContain('Fee must be a valid number: "abc"');
    });

    it('should normalize assets, types, and parse timestamps correctly', () => {
      const row1 = {
        transaction_id: ' TX-999 ',
        timestamp: '2026-05-23T12:00:00.000Z',
        type: ' transfer_out ',
        asset: ' bitcoin ',
        quantity: '5.2',
        fee: '0.1'
      };
      
      const normalized = normalizeTransactionRow(row1);
      expect(normalized.txId).toBe('TX-999');
      expect(normalized.type).toBe('TRANSFER_OUT');
      expect(normalized.asset).toBe('BTC'); // BTC alias mapping
      expect(normalized.quantity).toBe(5.2);
      expect(normalized.fee).toBe(0.1);
      expect(normalized.timestamp).toBeInstanceOf(Date);
      expect(normalized.timestamp.toISOString()).toBe('2026-05-23T12:00:00.000Z');
    });

    it('should fall back to original asset if no alias mapping exists', () => {
      const row = {
        transaction_id: 'TX1',
        timestamp: '2026-05-23T12:00:00.000Z',
        type: 'BUY',
        asset: 'ADA',
        quantity: '100'
      };
      const normalized = normalizeTransactionRow(row);
      expect(normalized.asset).toBe('ADA');
    });
  });

  // =========================================================================
  // SECTION 2: MATCHING STRATEGY & ENGINE
  // =========================================================================
  describe('2. Matching Strategy & Scoring Rules', () => {
    it('should align types correctly', () => {
      expect(checkTypeAlignment('BUY', 'BUY')).toBe(true);
      expect(checkTypeAlignment('TRANSFER_IN', 'TRANSFER_OUT')).toBe(true);
      expect(checkTypeAlignment('TRANSFER_OUT', 'TRANSFER_IN')).toBe(true);
      expect(checkTypeAlignment('BUY', 'SELL')).toBe(false);
    });

    it('should score an exact match with maximum score', () => {
      const userTx = {
        normalized: {
          asset: 'BTC',
          type: 'BUY',
          quantity: 1.0,
          timestamp: new Date('2026-05-23T10:00:00Z')
        }
      };
      const exchangeTx = {
        normalized: {
          asset: 'BTC',
          type: 'BUY',
          quantity: 1.0,
          timestamp: new Date('2026-05-23T10:00:00Z')
        }
      };

      const result = calculateMatchScore(userTx, exchangeTx);
      expect(result.isMatch).toBe(true);
      expect(result.confidence).toBe(1.0); // Exact match
    });

    it('should decay matching score linearly as difference approaches tolerances', () => {
      // Default: timestamp tolerance = 60s, quantity tolerance = 2% (0.02)
      // Timestamp diff = 30s (half of tolerance limit -> timestamp score = 25 instead of 50)
      // Quantity diff = 1% (half of tolerance limit -> quantity score = 15 instead of 30)
      // Type is BUY vs BUY (aligned -> type score = 20)
      // Expected totalScore = 20 (type) + 25 (timestamp) + 15 (quantity) = 60 -> confidence = 0.60
      const userTx = {
        normalized: {
          asset: 'BTC',
          type: 'BUY',
          quantity: 100.0,
          timestamp: new Date('2026-05-23T10:00:00Z')
        }
      };
      const exchangeTx = {
        normalized: {
          asset: 'BTC',
          type: 'BUY',
          quantity: 101.0, // 1% variance
          timestamp: new Date('2026-05-23T10:00:30Z') // 30s diff
        }
      };

      const result = calculateMatchScore(userTx, exchangeTx);
      expect(result.isMatch).toBe(true);
      expect(result.confidence).toBeCloseTo(0.60, 2);
    });

    it('should flag as a mismatch when values exceed tolerances', () => {
      const userTx = {
        normalized: {
          asset: 'BTC',
          type: 'BUY',
          quantity: 10.0,
          timestamp: new Date('2026-05-23T10:00:00Z')
        }
      };
      const exchangeTx = {
        normalized: {
          asset: 'BTC',
          type: 'BUY',
          quantity: 10.5, // 5% variance (exceeds 2% tolerance limit)
          timestamp: new Date('2026-05-23T10:00:10Z')
        }
      };

      const result = calculateMatchScore(userTx, exchangeTx);
      expect(result.isMatch).toBe(false);
      expect(result.reason).toContain('quantity variance');
    });

    it('should support custom tolerances overrides', () => {
      const userTx = {
        normalized: {
          asset: 'BTC',
          type: 'BUY',
          quantity: 10.0,
          timestamp: new Date('2026-05-23T10:00:00Z')
        }
      };
      const exchangeTx = {
        normalized: {
          asset: 'BTC',
          type: 'BUY',
          quantity: 10.5, // 5% variance (exceeds default 2% but inside custom 10% limit)
          timestamp: new Date('2026-05-23T10:00:10Z')
        }
      };

      const customTolerances = {
        timestampToleranceSeconds: 60,
        quantityTolerancePct: 0.10 // 10% tolerance limit
      };

      const result = calculateMatchScore(userTx, exchangeTx, customTolerances);
      expect(result.isMatch).toBe(true);
    });

    it('should support explicit zero tolerances (timestampTolerance=0, quantityTolerance=0)', () => {
      const userTx = {
        normalized: {
          asset: 'BTC',
          type: 'BUY',
          quantity: 10.0,
          timestamp: new Date('2026-05-23T10:00:00Z')
        }
      };
      
      const exactMatchTx = {
        normalized: {
          asset: 'BTC',
          type: 'BUY',
          quantity: 10.0,
          timestamp: new Date('2026-05-23T10:00:00Z')
        }
      };

      const slightDiffTx = {
        normalized: {
          asset: 'BTC',
          type: 'BUY',
          quantity: 10.0001,
          timestamp: new Date('2026-05-23T10:00:00Z')
        }
      };

      const zeroTolerances = {
        timestampToleranceSeconds: 0,
        quantityTolerancePct: 0
      };

      const exactResult = calculateMatchScore(userTx, exactMatchTx, zeroTolerances);
      expect(exactResult.isMatch).toBe(true);
      expect(exactResult.confidence).toBe(1.0);

      const slightResult = calculateMatchScore(userTx, slightDiffTx, zeroTolerances);
      expect(slightResult.isMatch).toBe(false);
      expect(slightResult.reason).toContain('quantity variance');
    });
  });

  // =========================================================================
  // SECTION 3: RECONCILIATION RUN INTEGRATION
  // =========================================================================
  describe('3. Two-Pass Reconciliation Engine execution', () => {
    it('should complete two-pass matching and correctly write results', async () => {
      const runId = 'test_run_123';
      
      // Create a run document
      await ReconciliationRun.create({
        runId,
        status: 'PENDING',
        config: { timestampTolerance: 60, quantityTolerance: 0.02 }
      });

      // Inject test transactions:
      // Pair 1: Match on ID (Pass 1)
      await Transaction.create({
        runId,
        source: 'USER',
        originalRow: {},
        normalized: { txId: 'TX-1', timestamp: new Date('2026-05-23T10:00:00Z'), type: 'BUY', asset: 'BTC', quantity: 1.0, fee: 0 },
        ingestionStatus: { valid: true },
        reconciliationStatus: 'UNRECONCILED'
      });
      await Transaction.create({
        runId,
        source: 'EXCHANGE',
        originalRow: {},
        normalized: { txId: 'TX-1', timestamp: new Date('2026-05-23T10:00:00Z'), type: 'BUY', asset: 'BTC', quantity: 1.0, fee: 0 },
        ingestionStatus: { valid: true },
        reconciliationStatus: 'UNRECONCILED'
      });

      // Pair 2: Conflict on ID (Pass 1)
      await Transaction.create({
        runId,
        source: 'USER',
        originalRow: {},
        normalized: { txId: 'TX-2', timestamp: new Date('2026-05-23T10:00:00Z'), type: 'BUY', asset: 'BTC', quantity: 2.0, fee: 0 },
        ingestionStatus: { valid: true },
        reconciliationStatus: 'UNRECONCILED'
      });
      await Transaction.create({
        runId,
        source: 'EXCHANGE',
        originalRow: {},
        normalized: { txId: 'TX-2', timestamp: new Date('2026-05-23T10:00:00Z'), type: 'BUY', asset: 'BTC', quantity: 3.5, fee: 0 }, // quantity mismatch
        ingestionStatus: { valid: true },
        reconciliationStatus: 'UNRECONCILED'
      });

      // Pair 3: Match on Proximity (Pass 2) - different IDs (so no Pass 1 match) but proximity aligns
      await Transaction.create({
        runId,
        source: 'USER',
        originalRow: {},
        normalized: { txId: 'TX-PROX-USR', timestamp: new Date('2026-05-23T10:05:00Z'), type: 'SELL', asset: 'ETH', quantity: 10.0, fee: 0 },
        ingestionStatus: { valid: true },
        reconciliationStatus: 'UNRECONCILED'
      });
      await Transaction.create({
        runId,
        source: 'EXCHANGE',
        originalRow: {},
        normalized: { txId: 'TX-PROX-EXC', timestamp: new Date('2026-05-23T10:05:02Z'), type: 'SELL', asset: 'ETH', quantity: 10.0, fee: 0 }, // aligns
        ingestionStatus: { valid: true },
        reconciliationStatus: 'UNRECONCILED'
      });

      // Pair 4: Unmatched user / unmatched exchange
      await Transaction.create({
        runId,
        source: 'USER',
        originalRow: {},
        normalized: { txId: 'TX-UNMATCHED-USR', timestamp: new Date('2026-05-23T11:00:00Z'), type: 'BUY', asset: 'SOL', quantity: 5.0, fee: 0 },
        ingestionStatus: { valid: true },
        reconciliationStatus: 'UNRECONCILED'
      });
      await Transaction.create({
        runId,
        source: 'EXCHANGE',
        originalRow: {},
        normalized: { txId: 'TX-UNMATCHED-EXC', timestamp: new Date('2026-05-23T12:00:00Z'), type: 'BUY', asset: 'SOL', quantity: 5.0, fee: 0 },
        ingestionStatus: { valid: true },
        reconciliationStatus: 'UNRECONCILED'
      });

      // Execute engine
      const summary = await runReconciliation(runId);
      expect(summary.success).toBe(true);

      expect(summary.summary.matchedCount).toBe(4); // 2 pairs = 4 transactions
      expect(summary.summary.conflictingCount).toBe(2); // 1 pair = 2 transactions
      expect(summary.summary.unmatchedUserCount).toBe(1);
      expect(summary.summary.unmatchedExchangeCount).toBe(1);

      // Verify report documents
      const matchedReports = await ReconciliationReport.find({ runId, category: 'matched' });
      expect(matchedReports.length).toBe(2); // 1 ID-based + 1 Proximity-based

      const conflictReports = await ReconciliationReport.find({ runId, category: 'conflicting' });
      expect(conflictReports.length).toBe(1);
    });
  });

  // =========================================================================
  // SECTION 4: REPORT SERVICE & EXPORTS
  // =========================================================================
  describe('4. Reporting & CSV/JSON Generation', () => {
    it('should export reports to CSV and JSON formats', async () => {
      const runId = 'report_run_abc';

      await ReconciliationRun.create({
        runId,
        status: 'PENDING',
      });

      const userTx = await Transaction.create({
        runId,
        source: 'USER',
        originalRow: {},
        normalized: { txId: 'TX-REP-1', timestamp: new Date('2026-05-23T10:00:00Z'), type: 'BUY', asset: 'BTC', quantity: 1.5, fee: 0 },
        ingestionStatus: { valid: true },
        reconciliationStatus: 'RECONCILED'
      });

      const exchangeTx = await Transaction.create({
        runId,
        source: 'EXCHANGE',
        originalRow: {},
        normalized: { txId: 'TX-REP-1', timestamp: new Date('2026-05-23T10:00:00Z'), type: 'BUY', asset: 'BTC', quantity: 1.5, fee: 0 },
        ingestionStatus: { valid: true },
        reconciliationStatus: 'RECONCILED'
      });

      await ReconciliationReport.create({
        runId,
        category: 'matched',
        confidence: 1.0,
        userTx: userTx._id,
        exchangeTx: exchangeTx._id,
        reason: 'Confirmed'
      });

      // Complete the run to COMPLETED status
      await ReconciliationRun.updateOne({ runId }, { status: 'COMPLETED' });

      const files = await generateReportsForRun(runId);
      expect(files.files.json).toContain(`report_${runId}.json`);
      expect(files.files.csv).toContain(`report_${runId}.csv`);

      // Read JSON
      const jsonContent = await fs.readFile(files.files.json, 'utf-8');
      const parsedJson = JSON.parse(jsonContent);
      expect(parsedJson.runId).toBe(runId);
      expect(parsedJson.reports[0].user_txId).toBe('TX-REP-1');

      // Read CSV
      const csvContent = await fs.readFile(files.files.csv, 'utf-8');
      const lines = csvContent.split('\n');
      expect(lines[0].trim()).toBe('category,confidence,reason,user_txId,user_timestamp,user_asset,user_quantity,exchange_txId,exchange_timestamp,exchange_asset,exchange_quantity');
      expect(lines[1]).toContain('matched');
      expect(lines[1]).toContain('TX-REP-1');

      // Clean up files
      await fs.unlink(files.files.json).catch(() => {});
      await fs.unlink(files.files.csv).catch(() => {});
    });
  });

  // =========================================================================
  // SECTION 5: REST API ENDPOINTS
  // =========================================================================
  describe('5. Express REST API Endpoints', () => {
    it('POST /api/reconciliation/reconcile - should fail on missing files', async () => {
      const res = await request(app)
        .post('/api/reconciliation/reconcile')
        .send({
          userFile: 'samples/user_transactions.csv'
          // Missing exchangeFile
        });
      
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('exchangeFile');
    });

    it('POST /api/reconciliation/reconcile - should succeed when parameters are valid', async () => {
      const res = await request(app)
        .post('/api/reconciliation/reconcile')
        .send({
          userFile: 'samples/user_transactions.csv',
          exchangeFile: 'samples/exchange_transactions.csv',
          config: {
            timestampTolerance: 120,
            quantityTolerance: 0.05
          }
        });
      
      expect(res.statusCode).toBe(202);
      expect(res.body.status).toBe('queued');
      expect(res.body.runId).toBeDefined();

      // Check run created in DB
      const run = await ReconciliationRun.findOne({ runId: res.body.runId });
      expect(run).toBeDefined();
      expect(run.config.timestampTolerance).toBe(120);
      expect(run.config.quantityTolerance).toBe(0.05);
    });

    it('GET /api/reconciliation/report/:runId - should return 404 if run not found', async () => {
      const res = await request(app).get('/api/reconciliation/report/invalid-run-id');
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('GET endpoints - should fetch report data, summary, and unmatched', async () => {
      const runId = 'api_run_test';

      await ReconciliationRun.create({
        runId,
        status: 'COMPLETED',
        summary: {
          totalTransactions: 2,
          matchedCount: 2,
          conflictingCount: 0,
          unmatchedUserCount: 0,
          unmatchedExchangeCount: 0
        }
      });

      const userTx = await Transaction.create({
        runId,
        source: 'USER',
        originalRow: {},
        normalized: { txId: 'TX-API-1', timestamp: new Date(), type: 'BUY', asset: 'BTC', quantity: 1.0, fee: 0 },
        ingestionStatus: { valid: true },
        reconciliationStatus: 'RECONCILED'
      });

      await ReconciliationReport.create({
        runId,
        category: 'matched',
        confidence: 1.0,
        userTx: userTx._id,
        exchangeTx: null,
        reason: 'API Test'
      });

      // Test Report Listing
      const resReport = await request(app).get(`/api/reconciliation/report/${runId}`);
      expect(resReport.statusCode).toBe(200);
      expect(resReport.body.success).toBe(true);
      expect(resReport.body.reports.length).toBe(1);
      expect(resReport.body.reports[0].user_txId).toBe('TX-API-1');

      // Test Summary
      const resSummary = await request(app).get(`/api/reconciliation/report/${runId}/summary`);
      expect(resSummary.statusCode).toBe(200);
      expect(resSummary.body.success).toBe(true);
      expect(resSummary.body.status).toBe('COMPLETED');
      expect(resSummary.body.summary.matchedCount).toBe(2);

      // Test Unmatched
      const resUnmatched = await request(app).get(`/api/reconciliation/report/${runId}/unmatched`);
      expect(resUnmatched.statusCode).toBe(200);
      expect(resUnmatched.body.success).toBe(true);
      expect(resUnmatched.body.unmatched.length).toBe(0); // We only have 'matched' record
    });

    it('GET /api/reconciliation/report/:runId/export - should return 404 if file does not exist', async () => {
      const res = await request(app).get('/api/reconciliation/report/missing-export/export');
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('GET /api/reconciliation/report/:runId/export - should return file if it exists', async () => {
      const runId = 'api_export_run';
      const reportsDir = path.resolve('reports');
      const csvPath = path.join(reportsDir, `report_${runId}.csv`);
      
      // Seed dummy file
      await fs.mkdir(reportsDir, { recursive: true });
      await fs.writeFile(csvPath, 'dummy csv data');

      const res = await request(app).get(`/api/reconciliation/report/${runId}/export`);
      expect(res.statusCode).toBe(200);
      expect(res.header['content-type']).toContain('text/csv');
      expect(res.header['content-disposition']).toContain(`reconciliation_report_${runId}.csv`);

      // Clean up file
      await fs.unlink(csvPath).catch(() => {});
    });
  });
});

