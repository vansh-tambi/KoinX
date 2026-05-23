import mongoose from 'mongoose';
import dotenv from 'dotenv';
import transactionRepository from './repositories/transactionRepository.js';
import reconciliationRunRepository from './repositories/reconciliationRunRepository.js';
import reconciliationReportRepository from './repositories/reconciliationReportRepository.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/reconciliation_test';

async function runTests() {
  console.log(`Connecting to MongoDB at: ${MONGODB_URI}`);
  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB connected successfully.\n');

  // Clear test collections
  await mongoose.connection.db.dropDatabase();
  console.log('Database cleared for testing.');

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

  // ==========================================
  // Test 1: Create Valid Transaction
  // ==========================================
  try {
    const txn = await transactionRepository.create({
      externalId: 'txn_101',
      provider: 'stripe', // will be converted to uppercase
      type: 'credit', // will be converted to uppercase
      status: 'success', // will be converted to uppercase
      amount: 150.50,
      currency: 'usd', // will be converted to uppercase
      normalizedAmount: 150.50,
      transactionDate: new Date('2026-05-23T10:00:00Z'),
      metadata: { department: 'sales', checkoutId: 'ch_9988' },
      raw: { id: 'ch_9988', object: 'charge', amount: 15050, currency: 'usd' }
    });

    assert(txn._id !== undefined, 'Transaction should have UUID as _id');
    assert(txn.provider === 'STRIPE', 'Provider should be normalized to uppercase STRIPE');
    assert(txn.type === 'CREDIT', 'Type should be normalized to uppercase CREDIT');
    assert(txn.status === 'SUCCESS', 'Status should be normalized to uppercase SUCCESS');
    assert(txn.currency === 'USD', 'Currency should be normalized to uppercase USD');
    assert(txn.reconciliationStatus === 'UNRECONCILED', 'Default reconciliationStatus should be UNRECONCILED');
    assert(txn.createdAt !== undefined, 'Timestamps (createdAt) should exist');
  } catch (err) {
    assert(false, `Should create valid transaction without errors: ${err.message}`);
  }

  // ==========================================
  // Test 2: Validation constraints on Transaction
  // ==========================================
  try {
    await transactionRepository.create({
      externalId: 'txn_102',
      provider: 'INVALID_PROVIDER',
      type: 'credit',
      status: 'success',
      amount: 100,
      currency: 'usd',
      normalizedAmount: 100,
      transactionDate: new Date()
    });
    assert(false, 'Should have failed with invalid provider enum');
  } catch (err) {
    assert(err.errors && err.errors.provider, 'Should reject invalid provider enum');
  }

  try {
    await transactionRepository.create({
      externalId: 'txn_102',
      provider: 'stripe',
      type: 'credit',
      status: 'success',
      amount: -50, // Negative amount
      currency: 'usd',
      normalizedAmount: -50,
      transactionDate: new Date()
    });
    assert(false, 'Should have failed with negative amount');
  } catch (err) {
    assert(err.errors && err.errors.amount, 'Should reject negative amount');
  }

  // ==========================================
  // Test 3: Compound Unique Index on (provider, externalId)
  // ==========================================
  try {
    await transactionRepository.create({
      externalId: 'txn_101', // Duplicate of Test 1
      provider: 'stripe',
      type: 'credit',
      status: 'success',
      amount: 100,
      currency: 'usd',
      normalizedAmount: 100,
      transactionDate: new Date()
    });
    assert(false, 'Should have failed with duplicate key error for externalId + provider');
  } catch (err) {
    assert(err.code === 11000, 'Should reject duplicate provider + externalId unique constraint (Mongo code 11000)');
  }

  // ==========================================
  // Test 4: Create Valid ReconciliationRun
  // ==========================================
  let runId;
  try {
    const run = await reconciliationRunRepository.create({
      runNumber: 'RUN-20260523-0001',
      status: 'pending',
      startedAt: new Date('2026-05-23T15:00:00Z'),
      initiatedBy: 'system_cron',
      rawConfig: { sourceFiles: ['s3://bucket/stripe-20260523.csv'] }
    });
    runId = run._id;
    assert(run._id !== undefined, 'ReconciliationRun should have UUID as _id');
    assert(run.status === 'PENDING', 'ReconciliationRun status should default to uppercase PENDING');
    assert(run.totalCount === 0, 'Default totalCount should be 0');
  } catch (err) {
    assert(false, `Should create valid ReconciliationRun without errors: ${err.message}`);
  }

  // ==========================================
  // Test 5: Validation on ReconciliationRun dates
  // ==========================================
  try {
    await reconciliationRunRepository.create({
      runNumber: 'RUN-20260523-0002',
      status: 'processing',
      startedAt: new Date('2026-05-23T15:00:00Z'),
      completedAt: new Date('2026-05-23T14:00:00Z'), // Completed BEFORE started
      initiatedBy: 'system_cron'
    });
    assert(false, 'Should have failed with completedAt before startedAt');
  } catch (err) {
    assert(err.errors && err.errors.completedAt, 'Should reject completedAt before startedAt');
  }

  // ==========================================
  // Test 6: Unique Run Number
  // ==========================================
  try {
    await reconciliationRunRepository.create({
      runNumber: 'RUN-20260523-0001', // Duplicate
      initiatedBy: 'manual_user'
    });
    assert(false, 'Should have failed with duplicate runNumber');
  } catch (err) {
    assert(err.code === 11000, 'Should reject duplicate runNumber (Mongo code 11000)');
  }

  // ==========================================
  // Test 7: Complete ReconciliationRun via Repository Method
  // ==========================================
  try {
    const updatedRun = await reconciliationRunRepository.completeRun(
      runId,
      { totalCount: 1500, reconciledCount: 1480, unreconciledCount: 20 },
      'COMPLETED'
    );
    assert(updatedRun.status === 'COMPLETED', 'completeRun should set status to COMPLETED');
    assert(updatedRun.totalCount === 1500, 'completeRun should update totalCount');
    assert(updatedRun.reconciledCount === 1480, 'completeRun should update reconciledCount');
    assert(updatedRun.unreconciledCount === 20, 'completeRun should update unreconciledCount');
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
      runId: runId,
      name: 'Stripe Reconciliation Report 2026-05-23',
      type: 'daily',
      status: 'draft',
      summary: {
        totalTransactions: 1500,
        matchedTransactions: 1480,
        mismatchedTransactions: 20,
        totalAmountReconciled: 148000,
        totalAmountMismatched: 2000,
        currency: 'usd'
      },
      discrepancies: [
        {
          transactionId: 'txn_101',
          type: 'AMOUNT_MISMATCH',
          severity: 'high',
          details: { expected: 150.50, actual: 150.00 }
        }
      ],
      rawReportData: { note: 'Stripe webhook received late' }
    });
    reportId = report._id;
    assert(report._id !== undefined, 'ReconciliationReport should have UUID as _id');
    assert(report.type === 'DAILY', 'Report type should be normalized to uppercase DAILY');
    assert(report.discrepancies.length === 1, 'Discrepancies subdocument should save successfully');
    assert(report.discrepancies[0].severity === 'HIGH', 'Discrepancy severity should be normalized to uppercase HIGH');
  } catch (err) {
    assert(false, `Should create valid ReconciliationReport without errors: ${err.message}`);
  }

  // ==========================================
  // Test 9: Repository Find Queries
  // ==========================================
  try {
    const reports = await reconciliationReportRepository.findByRunId(runId);
    assert(reports.length === 1 && reports[0]._id === reportId, 'findByRunId repository method should find the report');

    const txn = await transactionRepository.findByExternalId('stripe', 'txn_101');
    assert(txn !== null && txn.externalId === 'txn_101', 'findByExternalId repository method should find the transaction');
  } catch (err) {
    assert(false, `Repository find helper queries should succeed: ${err.message}`);
  }

  // ==========================================
  // Test 10: Repository Update Reconciliation Status
  // ==========================================
  try {
    const txn = await transactionRepository.findByExternalId('stripe', 'txn_101');
    const updatedTxn = await transactionRepository.updateReconciliation(txn._id, 'reconciled', runId);
    assert(updatedTxn.reconciliationStatus === 'RECONCILED', 'updateReconciliation should update status to RECONCILED');
    assert(updatedTxn.reconciliationRunId === runId, 'updateReconciliation should set reconciliationRunId');
  } catch (err) {
    assert(false, `updateReconciliation repository query should succeed: ${err.message}`);
  }

  // Summary
  console.log('\n==========================================');
  console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed.`);
  console.log('==========================================');

  await mongoose.disconnect();
  console.log('Database disconnected.');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test script crashed:', err);
  mongoose.disconnect();
  process.exit(1);
});
