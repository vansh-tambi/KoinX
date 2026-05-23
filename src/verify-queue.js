import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import Redis from 'ioredis';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Transaction from './models/transaction.js';
import ReconciliationRun from './models/reconciliationRun.js';
import ReconciliationReport from './models/reconciliationReport.js';
import reconciliationRunRepository from './repositories/reconciliationRunRepository.js';
import { ingestCsvFile } from './ingestion/ingestionService.js';
import { queueReconciliationJob } from './jobs/reconciliationQueue.js';
import { startReconciliationWorker } from './jobs/reconciliationWorker.js';

dotenv.config();

// Force in-memory database to bypass localhost port conflicts
const MONGODB_URI = '';

async function runQueueTests() {
  let mongoServer;
  let uri = MONGODB_URI;

  if (!uri) {
    console.log('Starting MongoMemoryServer for Queue Tests...');
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

  // 1. Verify Redis connectivity for BullMQ
  let isRedisRunning = false;
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  console.log(`Checking Redis connection at: ${redisUrl}`);
  const redisClient = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  
  try {
    await new Promise((resolve, reject) => {
      redisClient.ping((err, res) => {
        if (err || res !== 'PONG') {
          reject(err || new Error('No PONG response'));
        } else {
          resolve();
        }
      });
    });
    isRedisRunning = true;
    console.log('Redis server is active.');
  } catch (err) {
    console.log('Redis is NOT running. Performing Mock Queue Pipeline verification.');
  } finally {
    redisClient.disconnect();
  }

  const testRunId = 'recon_async_run_999';

  // 2. Insert ReconciliationRun
  try {
    await reconciliationRunRepository.create({
      runId: testRunId,
      status: 'PENDING',
      config: { description: 'Integration Test Async Queue Run' }
    });
    console.log(`Created ReconciliationRun: ${testRunId}`);
  } catch (err) {
    console.error('Failed to create ReconciliationRun:', err);
    process.exit(1);
  }

  // 3. Ingest CSV files
  const userCsvPath = path.resolve('samples/user_transactions.csv');
  const exchangeCsvPath = path.resolve('samples/exchange_transactions.csv');
  console.log('\nIngesting User & Exchange CSVs...');
  await ingestCsvFile(userCsvPath, testRunId, 'USER');
  await ingestCsvFile(exchangeCsvPath, testRunId, 'EXCHANGE');
  console.log('Ingestion completed.');

  // 4. Trigger Async Pipeline
  if (isRedisRunning) {
    console.log('\nStarting BullMQ background worker and enqueuing job...');
    const worker = startReconciliationWorker();
    
    // Add job to queue
    const job = await queueReconciliationJob(testRunId);
    assert(job !== undefined && job.id !== undefined, 'Should successfully add job to BullMQ');
    
    // Await worker completed event
    console.log('Waiting for worker to complete job processing...');
    await new Promise((resolve) => {
      worker.on('completed', (completedJob) => {
        if (completedJob.id === job.id) {
          console.log(`Worker finished processing job ${completedJob.id}`);
          resolve();
        }
      });
      // Timeout fallback (8 seconds)
      setTimeout(resolve, 8000);
    });

    await worker.close();
  } else {
    console.log('\nRunning mock queue pipeline execution...');
    // Direct invocation of the matching and reporting services to verify database transitions offline
    const run = await reconciliationRunRepository.findByRunId(testRunId);
    assert(run !== null, 'ReconciliationRun should exist');
    
    run.status = 'PROCESSING';
    await run.save();
    
    const { runReconciliation } = await import('./matching/services/reconciliationService.js');
    const { generateReportsForRun } = await import('./reporting/reportService.js');
    
    const matchResult = await runReconciliation(testRunId);
    const reportResult = await generateReportsForRun(testRunId);

    assert(matchResult.success === true, 'Reconciliation matching should succeed');
    assert(reportResult.success === true, 'Reporting export should succeed');
  }

  // ==========================================
  // Assertions on Database & State transitions
  // ==========================================
  console.log('\nRunning async workflow database assertions...');

  try {
    const run = await ReconciliationRun.findOne({ runId: testRunId });
    assert(run.status === 'COMPLETED', `ReconciliationRun status should transition to COMPLETED (actual: ${run.status})`);
    assert(run.summary.totalTransactions === 51, `ReconciliationRun summary totalTransactions should equal 51 (actual: ${run.summary.totalTransactions})`);
    assert(run.completedAt !== undefined, 'ReconciliationRun completedAt timestamp should be set');
  } catch (err) {
    assert(false, `ReconciliationRun validation failed: ${err.message}`);
  }

  try {
    const reportCount = await ReconciliationReport.countDocuments({ runId: testRunId });
    assert(reportCount > 0, `Should have generated report entries in the database (actual: ${reportCount})`);
  } catch (err) {
    assert(false, `ReconciliationReport count check failed: ${err.message}`);
  }

  // Summary
  console.log('\n==========================================');
  console.log(`ASYNC WORKFLOW TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed.`);
  console.log('==========================================');

  // Clean up temporary verification files
  try {
    const reportsDir = path.resolve('reports');
    await fs.unlink(path.join(reportsDir, `report_${testRunId}.json`));
    await fs.unlink(path.join(reportsDir, `report_${testRunId}.csv`));
    console.log('Temporary verification files cleaned up.');
  } catch (err) {
    // Ignore cleanup errors
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

runQueueTests().catch(async (err) => {
  console.error('Async workflow test crashed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
