import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Transaction from './models/transaction.js';
import ReconciliationRun from './models/reconciliationRun.js';
import ReconciliationReport from './models/reconciliationReport.js';
import reconciliationRunRepository from './repositories/reconciliationRunRepository.js';
import transactionRepository from './repositories/transactionRepository.js';
import { ingestCsvFile } from './ingestion/ingestionService.js';
import { runReconciliation } from './matching/services/reconciliationService.js';

dotenv.config();

// Always force in-memory database to avoid localhost conflicts
const MONGODB_URI = '';

async function runReconciliationTests() {
  let mongoServer;
  let uri = MONGODB_URI;

  if (!uri) {
    console.log('Starting MongoMemoryServer for Reconciliation Tests...');
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

  const testRunId = 'recon_run_555';

  // 1. Create a ReconciliationRun
  try {
    await reconciliationRunRepository.create({
      runId: testRunId,
      status: 'PENDING',
      config: { description: 'Integration Test Matching Run' }
    });
    console.log(`Created ReconciliationRun tracking record: ${testRunId}`);
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

  // 3. Inject manual transactions to test Pass 1 (ID-based matching & conflicts)
  console.log('\nInjecting custom ID-based transactions...');
  try {
    // Pass 1: Ideal match on ID
    await transactionRepository.create({
      runId: testRunId,
      source: 'USER',
      originalRow: {},
      normalized: {
        txId: 'TX-SHARED-MATCH',
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
        txId: 'TX-SHARED-MATCH',
        timestamp: new Date('2026-05-23T12:00:10Z'), // 10s difference (within 60s limit)
        type: 'BUY',
        asset: 'BTC',
        quantity: 1.0,
        fee: 0.001
      },
      ingestionStatus: { valid: true, issues: [] },
      reconciliationStatus: 'UNRECONCILED'
    });

    // Pass 1: Conflict match on ID
    await transactionRepository.create({
      runId: testRunId,
      source: 'USER',
      originalRow: {},
      normalized: {
        txId: 'TX-SHARED-CONFLICT',
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
        txId: 'TX-SHARED-CONFLICT',
        timestamp: new Date('2026-05-23T12:00:00Z'),
        type: 'BUY',
        asset: 'BTC',
        quantity: 5.5, // Quantity mismatch (5.5 vs 2.0)
        fee: 0.002
      },
      ingestionStatus: { valid: true, issues: [] },
      reconciliationStatus: 'UNRECONCILED'
    });

    console.log('Injected successfully.');
  } catch (err) {
    console.error('Injection failed:', err);
    process.exit(1);
  }

  // 4. Run Reconciliation Engine
  console.log('\nRunning Reconciliation matching engine...');
  let reconResult;
  try {
    reconResult = await runReconciliation(testRunId);
    console.log('Reconciliation run finished.');
    console.log('Summary:', JSON.stringify(reconResult.summary, null, 2));
  } catch (err) {
    console.error('Reconciliation crashed:', err);
    testsFailed++;
  }

  // ==========================================
  // Assertions on Reconciliation State
  // ==========================================
  console.log('\nRunning reconciliation state assertions...');

  // Assert Pass 1 Match
  try {
    const reportMatch = await ReconciliationReport.findOne({
      runId: testRunId,
      category: 'matched',
      reason: /Confirmed match/
    });
    assert(reportMatch !== null, 'Should find a Pass 1 "matched" report');
    assert(reportMatch.confidence > 0.9, 'Pass 1 match confidence should be high (close to 1.0)');
  } catch (err) {
    assert(false, `Pass 1 match assertion failed: ${err.message}`);
  }

  // Assert Pass 1 Conflict
  try {
    const reportConflict = await ReconciliationReport.findOne({
      runId: testRunId,
      category: 'conflicting'
    });
    assert(reportConflict !== null, 'Should find a Pass 1 "conflicting" report due to quantity mismatch');
    assert(reportConflict.reason.includes('quantity variance'), 'Conflict reason should specify quantity variance issues');
  } catch (err) {
    assert(false, `Pass 1 conflict assertion failed: ${err.message}`);
  }

  // Assert Pass 2 Match (Proximity Matching user USR-002 vs EXC-1002)
  try {
    // USR-002: timestamp=2024-03-01T11:30:00Z, type=BUY, asset=ETH, quantity=2.0
    // EXC-1002: timestamp=2024-03-01T11:30:00Z, type=BUY, asset=ETH, quantity=2.0
    const reportProximity = await ReconciliationReport.findOne({
      runId: testRunId,
      category: 'matched',
      reason: /Pass 2 Proximity Match/
    });
    assert(reportProximity !== null, 'Should find proximity matched records in Pass 2');
  } catch (err) {
    assert(false, `Pass 2 proximity assertion failed: ${err.message}`);
  }

  // Assert Unmatched User (transfers or other unmatched items)
  try {
    const reportUnmatchedUser = await ReconciliationReport.findOne({
      runId: testRunId,
      category: 'unmatched_user'
    });
    assert(reportUnmatchedUser !== null, 'Should find "unmatched_user" reports for user entries without exchange counterpart');
  } catch (err) {
    assert(false, `Unmatched user assertion failed: ${err.message}`);
  }

  // Assert Unmatched Exchange
  try {
    const reportUnmatchedExchange = await ReconciliationReport.findOne({
      runId: testRunId,
      category: 'unmatched_exchange'
    });
    assert(reportUnmatchedExchange !== null, 'Should find "unmatched_exchange" reports for exchange entries without user counterpart');
  } catch (err) {
    assert(false, `Unmatched exchange assertion failed: ${err.message}`);
  }

  // Assert Database Reconciliation Status updates
  try {
    const reconciledCount = await Transaction.countDocuments({ runId: testRunId, reconciliationStatus: 'RECONCILED' });
    const failedCount = await Transaction.countDocuments({ runId: testRunId, reconciliationStatus: 'FAILED' });
    
    assert(reconciledCount > 0, `Should have Reconciled status transactions (actual: ${reconciledCount})`);
    assert(failedCount > 0, `Should have Failed status transactions (actual: ${failedCount})`);
  } catch (err) {
    assert(false, `Transaction status assertion failed: ${err.message}`);
  }

  // Summary
  console.log('\n==========================================');
  console.log(`RECONCILIATION TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed.`);
  console.log('==========================================');

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

runReconciliationTests().catch(async (err) => {
  console.error('Reconciliation test crashed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
