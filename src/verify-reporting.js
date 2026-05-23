import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Transaction from './models/transaction.js';
import ReconciliationRun from './models/reconciliationRun.js';
import ReconciliationReport from './models/reconciliationReport.js';
import reconciliationRunRepository from './repositories/reconciliationRunRepository.js';
import transactionRepository from './repositories/transactionRepository.js';
import { ingestCsvFile } from './ingestion/ingestionService.js';
import { runReconciliation } from './matching/services/reconciliationService.js';
import { generateReportsForRun } from './reporting/reportService.js';

dotenv.config();

// Always force in-memory database to avoid localhost conflicts
const MONGODB_URI = '';

async function runReportingTests() {
  let mongoServer;
  let uri = MONGODB_URI;

  if (!uri) {
    console.log('Starting MongoMemoryServer for Reporting Tests...');
    mongoServer = await MongoMemoryServer.create();
    uri = mongoServer.getUri();
  }

  console.log(`Connecting to MongoDB at: ${uri}`);
  await mongoose.connect(uri);
  console.log('MongoDB connected successfully.\n');

  // Clear test database
  await mongoose.connection.db.dropDatabase();
  console.log('Database cleared.');

  // Synchronize model indexes
  await Transaction.init();
  await ReconciliationRun.init();
  await ReconciliationReport.init();
  console.log('Indexes synchronized.');

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ SUCCESS: ${message}`);
      testsPassed++;
    } else {
      console.error(`❌ FAILURE: ${message}`);
      testsFailed++;
    }
  }

  const testRunId = 'report_test_run_777';

  // 1. Create a ReconciliationRun
  try {
    await reconciliationRunRepository.create({
      runId: testRunId,
      status: 'PENDING',
      config: { description: 'Integration Test Report Run' }
    });
    console.log(`Created ReconciliationRun: ${testRunId}`);
  } catch (err) {
    console.error('Failed to create ReconciliationRun:', err);
    process.exit(1);
  }

  // 2. Ingest CSV files
  const userCsvPath = path.resolve('samples/user_transactions.csv');
  const exchangeCsvPath = path.resolve('samples/exchange_transactions.csv');

  console.log('\nIngesting User & Exchange CSVs...');
  await ingestCsvFile(userCsvPath, testRunId, 'USER');
  await ingestCsvFile(exchangeCsvPath, testRunId, 'EXCHANGE');
  console.log('Ingestion completed.');

  // 3. Inject custom ID-based transactions for Pass 1 matching and conflict testing
  try {
    await transactionRepository.create({
      runId: testRunId,
      source: 'USER',
      originalRow: {},
      normalized: {
        txId: 'TX-SHARED-MATCH-REP',
        timestamp: new Date('2026-05-23T12:00:00Z'),
        type: 'BUY',
        asset: 'BTC',
        quantity: 1.0,
        fee: 0.001
      },
      ingestionStatus: { valid: true, issues: [] },
      reconciliationStatus: 'UNRECONCILED'
    });

    await transactionRepository.create({
      runId: testRunId,
      source: 'EXCHANGE',
      originalRow: {},
      normalized: {
        txId: 'TX-SHARED-MATCH-REP',
        timestamp: new Date('2026-05-23T12:00:00Z'),
        type: 'BUY',
        asset: 'BTC',
        quantity: 1.0,
        fee: 0.001
      },
      ingestionStatus: { valid: true, issues: [] },
      reconciliationStatus: 'UNRECONCILED'
    });

    await transactionRepository.create({
      runId: testRunId,
      source: 'USER',
      originalRow: {},
      normalized: {
        txId: 'TX-SHARED-CONFLICT-REP',
        timestamp: new Date('2026-05-23T12:00:00Z'),
        type: 'BUY',
        asset: 'BTC',
        quantity: 2.0,
        fee: 0.002
      },
      ingestionStatus: { valid: true, issues: [] },
      reconciliationStatus: 'UNRECONCILED'
    });

    await transactionRepository.create({
      runId: testRunId,
      source: 'EXCHANGE',
      originalRow: {},
      normalized: {
        txId: 'TX-SHARED-CONFLICT-REP',
        timestamp: new Date('2026-05-23T12:00:00Z'),
        type: 'BUY',
        asset: 'BTC',
        quantity: 5.5, // Quantity mismatch
        fee: 0.002
      },
      ingestionStatus: { valid: true, issues: [] },
      reconciliationStatus: 'UNRECONCILED'
    });
  } catch (err) {
    console.error('Injection failed:', err);
    process.exit(1);
  }

  // 4. Run Reconciliation Matching
  console.log('\nRunning Reconciliation matching...');
  await runReconciliation(testRunId);
  console.log('Matching completed.');

  // 5. Generate and Export Reports
  console.log('\nGenerating and Exporting reports...');
  let reportServiceResult;
  try {
    reportServiceResult = await generateReportsForRun(testRunId);
    console.log('Report service run completed.');
    console.log(`Saved JSON: ${reportServiceResult.files.json}`);
    console.log(`Saved CSV: ${reportServiceResult.files.csv}`);
  } catch (err) {
    console.error('Report service failed:', err);
    testsFailed++;
  }

  // ==========================================
  // Assertions on Generated Report Files
  // ==========================================
  console.log('\nRunning report export assertions...');

  const { json: jsonPath, csv: csvPath } = reportServiceResult.files;

  // JSON File Assertions
  try {
    const jsonExists = await fs.access(jsonPath).then(() => true).catch(() => false);
    assert(jsonExists, 'JSON report file should exist on disk under reports/');
    
    if (jsonExists) {
      const rawJson = await fs.readFile(jsonPath, 'utf-8');
      const payload = JSON.parse(rawJson);
      
      assert(payload.runId === testRunId, 'JSON payload should contain correct runId');
      assert(payload.status === 'COMPLETED', 'JSON payload should show COMPLETED run status');
      assert(payload.reports.length > 0, 'JSON payload reports list should contain entries');
      
      // Check for nested columns matching user and exchange values
      const matchedReport = payload.reports.find(r => r.category === 'matched' && r.user_txId === 'TX-SHARED-MATCH-REP');
      assert(matchedReport !== undefined, 'JSON should contain flat report detailing matched user_txId');
      assert(matchedReport.exchange_txId === 'TX-SHARED-MATCH-REP', 'Matched report should contain correct exchange_txId');
      assert(matchedReport.user_quantity === 1, 'Matched report should contain correct user_quantity');
      assert(matchedReport.exchange_quantity === 1, 'Matched report should contain correct exchange_quantity');
    }
  } catch (err) {
    assert(false, `JSON report verification failed: ${err.message}`);
  }

  // CSV File Assertions
  try {
    const csvExists = await fs.access(csvPath).then(() => true).catch(() => false);
    assert(csvExists, 'CSV report file should exist on disk under reports/');

    if (csvExists) {
      const rawCsv = await fs.readFile(csvPath, 'utf-8');
      const lines = rawCsv.split('\n');
      
      // Header check
      const expectedHeader = 'category,confidence,reason,user_txId,user_timestamp,user_asset,user_quantity,exchange_txId,exchange_timestamp,exchange_asset,exchange_quantity';
      assert(lines[0].trim() === expectedHeader, 'CSV header should match the exact column list and sequence');
      
      // Validate that at least some transaction data lines exist
      assert(lines.length > 2, 'CSV file should contain data rows');

      // Verify a conflict row exists in the CSV output
      const conflictLine = lines.find(line => line.includes('conflicting') && line.includes('TX-SHARED-CONFLICT-REP'));
      assert(conflictLine !== undefined, 'CSV output should contain flat record for Conflict transaction');
    }
  } catch (err) {
    assert(false, `CSV report verification failed: ${err.message}`);
  }

  // Summary
  console.log('\n==========================================');
  console.log(`REPORTING TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed.`);
  console.log('==========================================');

  // Clean up test files generated
  try {
    await fs.unlink(jsonPath);
    await fs.unlink(csvPath);
    console.log('Temporary verification files cleaned up.');
  } catch (err) {
    console.warn('Failed to clean up files:', err.message);
  }

  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
  console.log('Database disconnected.');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runReportingTests().catch(async (err) => {
  console.error('Reporting test crashed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
