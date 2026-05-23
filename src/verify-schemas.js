import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Transaction from './models/transaction.js';
import ReconciliationRun from './models/reconciliationRun.js';
import ReconciliationReport from './models/reconciliationReport.js';
import transactionRepository from './repositories/transactionRepository.js';
import reconciliationRunRepository from './repositories/reconciliationRunRepository.js';
import reconciliationReportRepository from './repositories/reconciliationReportRepository.js';

dotenv.config();

// Always force in-memory database during verification suite to avoid localhost port conflicts
const MONGODB_URI = ''; 

async function runTests() {
  let mongoServer;
  let uri = MONGODB_URI;

  if (!uri) {
    console.log('Starting MongoMemoryServer...');
    mongoServer = await MongoMemoryServer.create();
    uri = mongoServer.getUri();
  }

  console.log(`Connecting to MongoDB at: ${uri}`);
  await mongoose.connect(uri);
  console.log('MongoDB connected successfully.\n');

  // Clear test collections
  await mongoose.connection.db.dropDatabase();
  console.log('Database cleared for testing.');

  // Ensure indexes are built
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

  // Define a shared runId for relational testing
  const testRunId = 'run_uuid_999';

  // ==========================================
  // Test 1: Create Valid Transaction
  // ==========================================
  let txnId;
  try {
    const txn = await transactionRepository.create({
      runId: testRunId,
      source: 'user', // will be converted to uppercase USER
      originalRow: { tx_id: 'TXN-101', type: 'buy', amount: '2.5' },
      normalized: {
        txId: 'TXN-101',
        timestamp: new Date('2026-05-23T10:00:00Z'),
        type: 'buy', // will be converted to uppercase BUY
        asset: 'btc', // will be converted to uppercase BTC
        quantity: 2.5,
        fee: 0.001
      },
      ingestionStatus: { valid: true, issues: [] },
      reconciliationStatus: 'unreconciled' // will be converted to uppercase UNRECONCILED
    });

    txnId = txn._id;
    assert(txn._id !== undefined, 'Transaction should have UUID as _id');
    assert(txn.source === 'USER', 'Source should be normalized to uppercase USER');
    assert(txn.normalized.type === 'BUY', 'Type should be normalized to uppercase BUY');
    assert(txn.normalized.asset === 'BTC', 'Asset should be normalized to uppercase BTC');
    assert(txn.reconciliationStatus === 'UNRECONCILED', 'Status should be normalized to uppercase UNRECONCILED');
    assert(txn.createdAt !== undefined, 'Timestamps (createdAt) should exist');
  } catch (err) {
    assert(false, `Should create valid transaction without errors: ${err.message}`);
  }

  // ==========================================
  // Test 2: Validation constraints on Transaction
  // ==========================================
  try {
    await transactionRepository.create({
      runId: testRunId,
      source: 'INVALID_SOURCE',
      originalRow: {},
      normalized: {
        txId: 'TXN-102',
        timestamp: new Date(),
        type: 'buy',
        asset: 'eth',
        quantity: 1
      }
    });
    assert(false, 'Should have failed with invalid source enum');
  } catch (err) {
    assert(err.errors && err.errors.source, 'Should reject invalid source enum');
  }

  try {
    await transactionRepository.create({
      runId: testRunId,
      source: 'user',
      originalRow: {},
      normalized: {
        txId: 'TXN-102',
        timestamp: new Date(),
        type: 'buy',
        asset: 'eth',
        quantity: -5 // Negative quantity
      }
    });
    assert(false, 'Should have failed with negative quantity');
  } catch (err) {
    assert(err.errors && err.errors['normalized.quantity'], 'Should reject negative quantity');
  }

  // ==========================================
  // Test 3: Compound Unique Index on (runId, source, normalized.txId)
  // ==========================================
  try {
    await transactionRepository.create({
      runId: testRunId,
      source: 'user',
      originalRow: {},
      normalized: {
        txId: 'TXN-101', // Duplicate of Test 1 under same run and source
        timestamp: new Date(),
        type: 'buy',
        asset: 'btc',
        quantity: 2.5
      }
    });
    assert(false, 'Should have failed with duplicate key error for runId + source + normalized.txId');
  } catch (err) {
    assert(err.code === 11000, 'Should reject duplicate runId + source + normalized.txId (Mongo code 11000)');
  }

  // ==========================================
  // Test 4: Create Valid ReconciliationRun
  // ==========================================
  let runId;
  const oneMinuteAgo = new Date(Date.now() - 60000);
  try {
    const run = await reconciliationRunRepository.create({
      runId: testRunId,
      config: { toleranceAmount: 0.01 },
      status: 'pending',
      summary: { totalCount: 100, reconciledCount: 0, unreconciledCount: 100 },
      startedAt: oneMinuteAgo
    });
    runId = run._id;
    assert(run._id !== undefined, 'ReconciliationRun should have UUID as _id');
    assert(run.status === 'PENDING', 'ReconciliationRun status should default to uppercase PENDING');
    assert(run.summary.totalCount === 100, 'Summary totalCount should save correctly');
  } catch (err) {
    assert(false, `Should create valid ReconciliationRun without errors: ${err.message}`);
  }

  // ==========================================
  // Test 5: Validation on ReconciliationRun dates
  // ==========================================
  try {
    await reconciliationRunRepository.create({
      runId: 'run_uuid_error',
      status: 'processing',
      startedAt: oneMinuteAgo,
      completedAt: new Date(oneMinuteAgo.getTime() - 1000), // Completed BEFORE started
      initiatedBy: 'system_cron'
    });
    assert(false, 'Should have failed with completedAt before startedAt');
  } catch (err) {
    assert(err.errors && err.errors.completedAt, 'Should reject completedAt before startedAt');
  }

  // ==========================================
  // Test 6: Unique runId
  // ==========================================
  try {
    await reconciliationRunRepository.create({
      runId: testRunId, // Duplicate of Test 4
      status: 'processing'
    });
    assert(false, 'Should have failed with duplicate runId');
  } catch (err) {
    assert(err.code === 11000, 'Should reject duplicate runId (Mongo code 11000)');
  }

  // ==========================================
  // Test 7: Complete ReconciliationRun via Repository Method
  // ==========================================
  try {
    const updatedRun = await reconciliationRunRepository.completeRun(
      runId,
      { totalCount: 1000, reconciledCount: 950, unreconciledCount: 50 },
      'completed'
    );
    assert(updatedRun.status === 'COMPLETED', 'completeRun should set status to COMPLETED');
    assert(updatedRun.summary.totalCount === 1000, 'completeRun should update summary totalCount');
    assert(updatedRun.summary.reconciledCount === 950, 'completeRun should update summary reconciledCount');
    assert(updatedRun.summary.unreconciledCount === 50, 'completeRun should update summary unreconciledCount');
    assert(updatedRun.completedAt >= updatedRun.startedAt, 'completedAt should be updated and after startedAt');
  } catch (err) {
    assert(false, `completeRun should update run details successfully: ${err.message}`);
  }

  // ==========================================
  // Test 8: Create Valid ReconciliationReport
  // ==========================================
  let reportId;
  try {
    const report = await reconciliationReportRepository.create({
      runId: testRunId,
      category: 'conflicting',
      confidence: 0.85,
      userTx: txnId,
      exchangeTx: 'EXC-TX-999',
      reason: 'Quantity mismatch: user recorded 2.5 but exchange recorded 2.4'
    });
    reportId = report._id;
    assert(report._id !== undefined, 'ReconciliationReport should have UUID as _id');
    assert(report.category === 'conflicting', 'Report category should be normalized to lowercase conflicting');
    assert(report.confidence === 0.85, 'Confidence score should save successfully');
    assert(report.exchangeTx === 'EXC-TX-999', 'Exchange reference should save successfully');
  } catch (err) {
    assert(false, `Should create valid ReconciliationReport without errors: ${err.message}`);
  }

  // ==========================================
  // Test 9: Validation constraints on ReconciliationReport
  // ==========================================
  try {
    await reconciliationReportRepository.create({
      runId: testRunId,
      category: 'matched',
      confidence: 1.5, // confidence > 1
      reason: 'Failed test'
    });
    assert(false, 'Should have failed with confidence > 1');
  } catch (err) {
    assert(err.errors && err.errors.confidence, 'Should reject confidence score > 1');
  }

  // ==========================================
  // Test 10: Repository Find Queries
  // ==========================================
  try {
    const reports = await reconciliationReportRepository.findByRunId(testRunId);
    assert(reports.length === 1 && reports[0]._id === reportId, 'findByRunId repository method should find the report');

    const txn = await transactionRepository.findByTxId(testRunId, 'user', 'TXN-101');
    assert(txn !== null && txn.normalized.txId === 'TXN-101', 'findByTxId repository method should find the transaction');
  } catch (err) {
    assert(false, `Repository find helper queries should succeed: ${err.message}`);
  }

  // ==========================================
  // Test 11: Repository Update Reconciliation Status
  // ==========================================
  try {
    const txn = await transactionRepository.findByTxId(testRunId, 'user', 'TXN-101');
    const updatedTxn = await transactionRepository.updateReconciliation(txn._id, 'reconciled');
    assert(updatedTxn.reconciliationStatus === 'RECONCILED', 'updateReconciliation should update status to RECONCILED');
  } catch (err) {
    assert(false, `updateReconciliation repository query should succeed: ${err.message}`);
  }

  // Summary
  console.log('\n==========================================');
  console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed.`);
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

runTests().catch(async (err) => {
  console.error('Test script crashed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
