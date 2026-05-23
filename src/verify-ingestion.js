import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Transaction from './models/transaction.js';
import ReconciliationRun from './models/reconciliationRun.js';
import reconciliationRunRepository from './repositories/reconciliationRunRepository.js';
import { ingestCsvFile } from './ingestion/ingestionService.js';

dotenv.config();

// Always force in-memory database to avoid localhost conflicts
const MONGODB_URI = '';

async function runIngestionTests() {
  let mongoServer;
  let uri = MONGODB_URI;

  if (!uri) {
    console.log('Starting MongoMemoryServer for Ingestion Tests...');
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

  const testRunId = 'ingest_run_123';

  // 1. Create a ReconciliationRun
  try {
    await reconciliationRunRepository.create({
      runId: testRunId,
      status: 'PENDING',
      config: { description: 'Integration Test Ingestion Run' }
    });
    console.log(`Created ReconciliationRun tracking record: ${testRunId}`);
  } catch (err) {
    console.error('Failed to create ReconciliationRun:', err);
    process.exit(1);
  }

  const userCsvPath = path.resolve('samples/user_transactions.csv');
  const exchangeCsvPath = path.resolve('samples/exchange_transactions.csv');

  console.log(`\nIngesting User transactions from: ${userCsvPath}`);
  let userResult;
  try {
    userResult = await ingestCsvFile(userCsvPath, testRunId, 'USER');
    console.log('Ingested User CSV successfully.');
    console.log(`Stats: total=${userResult.totalRows}, valid=${userResult.validRows}, invalid=${userResult.invalidRows}`);
  } catch (err) {
    console.error('User CSV ingestion failed:', err);
    testsFailed++;
  }

  console.log(`\nIngesting Exchange transactions from: ${exchangeCsvPath}`);
  let exchangeResult;
  try {
    exchangeResult = await ingestCsvFile(exchangeCsvPath, testRunId, 'EXCHANGE');
    console.log('Ingested Exchange CSV successfully.');
    console.log(`Stats: total=${exchangeResult.totalRows}, valid=${exchangeResult.validRows}, invalid=${exchangeResult.invalidRows}`);
  } catch (err) {
    console.error('Exchange CSV ingestion failed:', err);
    testsFailed++;
  }

  // ==========================================
  // Assertions on Database State
  // ==========================================
  console.log('\nRunning database state assertions...');

  // Total counts checks
  try {
    const totalTransactions = await Transaction.countDocuments({ runId: testRunId });
    // user file has 26 rows of transactions (excluding empty line), exchange has 25 rows
    assert(totalTransactions === 51, `Should have ingested exactly 51 rows in total (actual: ${totalTransactions})`);
  } catch (err) {
    assert(false, `Failed to count transactions: ${err.message}`);
  }

  // Validate that invalid rows are NOT dropped and are correctly flagged
  try {
    // Malformed timestamp in user row USR-018
    const txMalformedTime = await Transaction.findOne({ runId: testRunId, 'normalized.txId': 'USR-018' });
    assert(txMalformedTime !== null, 'USR-018 should be stored in the database');
    assert(txMalformedTime.ingestionStatus.valid === false, 'USR-018 should have valid = false');
    assert(
      txMalformedTime.ingestionStatus.issues.some(issue => issue.includes('Invalid timestamp')),
      'USR-018 issues list should report invalid timestamp format'
    );
  } catch (err) {
    assert(false, `Failed to verify USR-018: ${err.message}`);
  }

  try {
    // Negative quantity in user row USR-019
    const txNegativeQty = await Transaction.findOne({ runId: testRunId, 'normalized.txId': 'USR-019' });
    assert(txNegativeQty !== null, 'USR-019 should be stored in the database');
    assert(txNegativeQty.ingestionStatus.valid === false, 'USR-019 should have valid = false');
    assert(
      txNegativeQty.ingestionStatus.issues.some(issue => issue.includes('Quantity must be positive')),
      'USR-019 issues list should report positive quantity constraint violation'
    );
  } catch (err) {
    assert(false, `Failed to verify USR-019: ${err.message}`);
  }

  try {
    // Missing type in user row USR-024
    const txMissingType = await Transaction.findOne({ runId: testRunId, 'normalized.txId': 'USR-024' });
    assert(txMissingType !== null, 'USR-024 should be stored in the database');
    assert(txMissingType.ingestionStatus.valid === false, 'USR-024 should have valid = false');
    assert(
      txMissingType.ingestionStatus.issues.some(issue => issue.includes('Missing required field: type')),
      'USR-024 issues list should report missing type field'
    );
  } catch (err) {
    assert(false, `Failed to verify USR-024: ${err.message}`);
  }

  // Duplicate txId check (USR-001 is duplicate on line 17 of user file)
  try {
    const txDuplicates = await Transaction.find({ runId: testRunId, 'normalized.txId': 'USR-001' });
    assert(txDuplicates.length === 2, `Should have stored both occurrences of duplicate txId USR-001 (actual: ${txDuplicates.length})`);
    
    // The second transaction should have duplicate validation error
    const duplicateRecord = txDuplicates.find(tx => tx.ingestionStatus.issues.length > 0);
    assert(duplicateRecord !== undefined, 'Second USR-001 transaction should have ingestion issues');
    assert(
      duplicateRecord.ingestionStatus.issues.some(issue => issue.includes('Duplicate transaction ID')),
      'Second USR-001 should report file-level duplicate transaction ID issue'
    );
  } catch (err) {
    assert(false, `Failed to verify duplicate USR-001: ${err.message}`);
  }

  // Normalization checks: asset aliases mapping (bitcoin -> BTC)
  try {
    const txBitcoin = await Transaction.findOne({ runId: testRunId, 'normalized.txId': 'USR-005' });
    assert(txBitcoin !== null, 'USR-005 should be stored');
    assert(txBitcoin.originalRow.asset === 'bitcoin', 'Original row asset should be "bitcoin"');
    assert(txBitcoin.normalized.asset === 'BTC', 'Normalized asset should be mapped to uppercase "BTC"');
  } catch (err) {
    assert(false, `Failed to verify USR-005 normalization: ${err.message}`);
  }

  // Normalization checks: date mapping (2024-03-01T09:00:00Z -> Date Object)
  try {
    const txValid = await Transaction.findOne({ runId: testRunId, 'normalized.txId': 'USR-002' });
    assert(txValid !== null, 'USR-002 should be stored');
    assert(txValid.normalized.timestamp instanceof Date, 'Normalized timestamp should be parsed as Date object');
    assert(txValid.normalized.timestamp.toISOString() === '2024-03-01T11:30:00.000Z', 'Date should be correct UTC time');
  } catch (err) {
    assert(false, `Failed to verify USR-002 date normalization: ${err.message}`);
  }

  // ReconciliationRun Metrics Checks
  try {
    const totalCount = userResult.rowsProcessed + exchangeResult.rowsProcessed;
    const unreconciledCount = userResult.validRows + exchangeResult.validRows;
    const invalidCount = userResult.invalidRows + exchangeResult.invalidRows;
    const rowsInserted = userResult.rowsInserted + exchangeResult.rowsInserted;
    const rowsFailed = userResult.rowsFailed + exchangeResult.rowsFailed;

    const run = await ReconciliationRun.findOne({ runId: testRunId });
    run.status = 'COMPLETED';
    run.summary = {
      totalCount,
      reconciledCount: 0,
      unreconciledCount,
      invalidCount,
      rowsProcessed: totalCount,
      rowsInserted,
      rowsFailed,
    };
    await run.save();

    assert(run.status === 'COMPLETED', 'ReconciliationRun status should be COMPLETED');
    assert(run.summary.totalCount === 51, `Run summary total count should equal 51 (actual: ${run.summary.totalCount})`);
    assert(run.summary.rowsProcessed === 51, `Run summary rowsProcessed should equal 51 (actual: ${run.summary.rowsProcessed})`);
    assert(run.summary.rowsInserted === 51, `Run summary rowsInserted should equal 51 (actual: ${run.summary.rowsInserted})`);
    assert(run.summary.rowsFailed === 0, `Run summary rowsFailed should equal 0 (actual: ${run.summary.rowsFailed})`);
  } catch (err) {
    assert(false, `Failed to verify ReconciliationRun: ${err.message}`);
  }

  // Summary
  console.log('\n==========================================');
  console.log(`INGESTION TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed.`);
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

runIngestionTests().catch(async (err) => {
  console.error('Ingestion test crashed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
