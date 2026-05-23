import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';
import reconciliationController from './controllers/reconciliationController.js';
import Transaction from './models/transaction.js';
import ReconciliationRun from './models/reconciliationRun.js';
import ReconciliationReport from './models/reconciliationReport.js';

dotenv.config();

// Force in-memory database during verification suite to avoid localhost conflicts
const MONGODB_URI = '';

async function runApiTests() {
  let mongoServer;
  let uri = MONGODB_URI;

  if (!uri) {
    console.log('Starting MongoMemoryServer for API Tests...');
    mongoServer = await MongoMemoryServer.create();
    uri = mongoServer.getUri();
  }

  // Inject in-memory MongoDB URI into process.env so that Express app.js connects to it
  process.env.MONGODB_URI = uri;

  console.log(`Connecting to MongoDB at: ${uri}`);
  await mongoose.connect(uri);
  console.log('MongoDB connected successfully.\n');

  // Clear test database
  await mongoose.connection.db.dropDatabase();
  console.log('Database cleared.');

  // Import the Express app dynamically after setting process.env.MONGODB_URI
  const { default: app } = await import('./app.js');
  
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

  // Synchronize Mongoose model indexes
  await Transaction.init();
  await ReconciliationRun.init();
  await ReconciliationReport.init();

  // ==========================================
  // Test 1: POST /reconcile - Zod Validation Failure
  // ==========================================
  console.log('\nTesting POST /reconcile - Validation Errors...');
  const mockResValidation = {
    statusCode: 200,
    jsonPayload: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(payload) {
      this.jsonPayload = payload;
      return this;
    }
  };

  // Missing required parameters (e.g. missing exchangeFile)
  await reconciliationController.triggerReconciliation(
    { body: { userFile: 'samples/user_transactions.csv' } },
    mockResValidation,
    (err) => console.error('Next middleware called:', err)
  );

  assert(mockResValidation.statusCode === 400, 'Should return status 400 Bad Request on validation failure');
  assert(
    mockResValidation.jsonPayload.error.message.includes('exchangeFile'),
    'Error payload should specify missing exchangeFile parameter'
  );

  // ==========================================
  // Test 2: POST /reconcile - Valid Request Trigger
  // ==========================================
  console.log('\nTesting POST /reconcile - Successful Trigger...');
  const mockResSuccess = {
    statusCode: 200,
    jsonPayload: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(payload) {
      this.jsonPayload = payload;
      return this;
    }
  };

  const userCsv = path.resolve('samples/user_transactions.csv');
  const exchangeCsv = path.resolve('samples/exchange_transactions.csv');

  await reconciliationController.triggerReconciliation(
    { 
      body: { 
        userFile: userCsv,
        exchangeFile: exchangeCsv,
        config: {
          timestampTolerance: 60,
          quantityTolerance: 0.02
        }
      } 
    },
    mockResSuccess,
    (err) => console.error('Controller crashed:', err)
  );

  assert(mockResSuccess.statusCode === 202, 'Should return status 202 Accepted on queuing run');
  assert(mockResSuccess.jsonPayload.status === 'queued', 'Response status field should equal "queued"');
  assert(mockResSuccess.jsonPayload.runId !== undefined, 'Response should return a generated runId');

  const activeRunId = mockResSuccess.jsonPayload.runId;

  // ==========================================
  // Test 3: Run Ingest, Matching and Reporting (Worker Sim)
  // ==========================================
  console.log('\nProcessing the enqueued job...');
  
  // Directly trigger matching pipeline using the controllers' run parameters
  const { ingestCsvFile } = await import('./ingestion/ingestionService.js');
  const { runReconciliation } = await import('./matching/services/reconciliationService.js');
  const { generateReportsForRun } = await import('./reporting/reportService.js');

  // Update status to processing
  const run = await ReconciliationRun.findOne({ runId: activeRunId });
  run.status = 'PROCESSING';
  await run.save();

  // Load files
  await ingestCsvFile(userCsv, activeRunId, 'USER');
  await ingestCsvFile(exchangeCsv, activeRunId, 'EXCHANGE');
  await runReconciliation(activeRunId);
  await generateReportsForRun(activeRunId);
  console.log('Background worker pipeline simulated.');

  // ==========================================
  // Test 4: GET /report/:runId - Listing Flat Reports
  // ==========================================
  console.log('\nTesting GET /report/:runId - Fetching flat list...');
  const mockResReports = {
    statusCode: 200,
    jsonPayload: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(payload) {
      this.jsonPayload = payload;
      return this;
    }
  };

  await reconciliationController.getReconciliationReport(
    { params: { runId: activeRunId } },
    mockResReports,
    (err) => console.error(err)
  );

  assert(mockResReports.statusCode === 200, 'Should return status 200 OK');
  assert(mockResReports.jsonPayload.success === true, 'Response success should be true');
  assert(mockResReports.jsonPayload.reports.length > 0, 'Reports list should contain populated transactions');

  // Verify flat mapping columns exist in response
  const reportItem = mockResReports.jsonPayload.reports[0];
  assert(reportItem.category !== undefined, 'Report item should have "category"');
  assert(reportItem.confidence !== undefined, 'Report item should have "confidence"');
  assert(reportItem.user_txId !== undefined, 'Report item should have "user_txId"');
  assert(reportItem.exchange_txId !== undefined, 'Report item should have "exchange_txId"');

  // ==========================================
  // Test 5: GET /report/:runId/summary - Fetching Summaries
  // ==========================================
  console.log('\nTesting GET /report/:runId/summary...');
  const mockResSummary = {
    statusCode: 200,
    jsonPayload: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(payload) {
      this.jsonPayload = payload;
      return this;
    }
  };

  await reconciliationController.getReconciliationSummary(
    { params: { runId: activeRunId } },
    mockResSummary,
    (err) => console.error(err)
  );

  assert(mockResSummary.statusCode === 200, 'Should return status 200 OK');
  assert(mockResSummary.jsonPayload.status === 'COMPLETED', 'Summary status should be COMPLETED');
  assert(mockResSummary.jsonPayload.summary.totalTransactions === 47, 'Summary total count should match valid rows');

  // ==========================================
  // Test 6: GET /report/:runId/unmatched - Fetching Unmatched
  // ==========================================
  console.log('\nTesting GET /report/:runId/unmatched...');
  const mockResUnmatched = {
    statusCode: 200,
    jsonPayload: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(payload) {
      this.jsonPayload = payload;
      return this;
    }
  };

  await reconciliationController.getUnmatchedReports(
    { params: { runId: activeRunId } },
    mockResUnmatched,
    (err) => console.error(err)
  );

  assert(mockResUnmatched.statusCode === 200, 'Should return status 200 OK');
  assert(mockResUnmatched.jsonPayload.unmatched.length > 0, 'Unmatched reports list should be returned');
  assert(
    mockResUnmatched.jsonPayload.unmatched.every(r => ['unmatched_user', 'unmatched_exchange'].includes(r.category)),
    'All returned records should belong only to unmatched user/exchange categories'
  );

  // ==========================================
  // Test 7: GET /report/:runId/export - Downloading CSV File
  // ==========================================
  console.log('\nTesting GET /report/:runId/export - Downloading File...');
  let downloadTriggered = false;
  let downloadedPath = '';
  const mockResDownload = {
    statusCode: 200,
    jsonPayload: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(payload) {
      this.jsonPayload = payload;
      return this;
    },
    download: function(filePath, filename) {
      downloadTriggered = true;
      downloadedPath = filePath;
    }
  };

  await reconciliationController.exportReportCsv(
    { params: { runId: activeRunId } },
    mockResDownload,
    (err) => console.error(err)
  );

  assert(downloadTriggered === true, 'Should trigger Express res.download handler');
  assert(downloadedPath.includes(`report_${activeRunId}.csv`), 'Downloaded path should resolve to correct report file');

  // Summary
  console.log('\n==========================================');
  console.log(`REST API TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed.`);
  console.log('==========================================');

  // Clean up reports files
  try {
    const reportsDir = path.resolve('reports');
    await fs.unlink(path.join(reportsDir, `report_${activeRunId}.json`));
    await fs.unlink(path.join(reportsDir, `report_${activeRunId}.csv`));
  } catch (err) {}

  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
  console.log('Database disconnected.');

  // Exit with status code
  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runApiTests().catch(async (err) => {
  console.error('API test crashed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
