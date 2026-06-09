import { Worker } from 'bullmq';
import redisConfig from '../config/redis.js';
import { ingestCsvFile } from '../ingestion/ingestionService.js';
import { runReconciliation } from '../matching/services/reconciliationService.js';
import { generateReportsForRun } from '../reporting/reportService.js';
import reconciliationRunRepository from '../repositories/reconciliationRunRepository.js';

const connection = {
  host: redisConfig.host,
  port: redisConfig.port,
};

/**
 * Orchestrates the full async pipeline for a reconciliation run.
 * Can be run in-process or inside a BullMQ worker context.
 * 
 * @param {Object} job - A job-like structure containing job.data and job.updateProgress.
 */
export const processReconciliationRun = async (job) => {
  const { runId, userFile, exchangeFile } = job.data;
  console.log(`[WORKER] Starting job ${job.id} for runId: ${runId}`);
  
  try {
    // 1. Fetch ReconciliationRun
    const run = await reconciliationRunRepository.findByRunId(runId);
    if (!run) {
      throw new Error(`ReconciliationRun not found with runId: ${runId}`);
    }

    // Update run status to PROCESSING
    run.status = 'PROCESSING';
    run.progress = 0;
    run.summary = {
      totalCount: 0,
      reconciledCount: 0,
      unreconciledCount: 0,
      invalidCount: 0,
    };
    await run.save();
    await job.updateProgress(0);

    // 2. Ingest CSV files
    console.log(`[WORKER] Ingesting User file: ${userFile}`);
    const userResult = await ingestCsvFile(userFile, runId, 'USER');
    run.progress = 30;
    await run.save();
    await job.updateProgress(30);

    console.log(`[WORKER] Ingesting Exchange file: ${exchangeFile}`);
    const exchangeResult = await ingestCsvFile(exchangeFile, runId, 'EXCHANGE');

    // Update run status with ingestion metrics and transition to MATCHING
    const totalCount = userResult.rowsProcessed + exchangeResult.rowsProcessed;
    const unreconciledCount = userResult.validRows + exchangeResult.validRows;
    const invalidCount = userResult.invalidRows + exchangeResult.invalidRows;
    const rowsInserted = userResult.rowsInserted + exchangeResult.rowsInserted;
    const rowsFailed = userResult.rowsFailed + exchangeResult.rowsFailed;
    
    run.summary = {
      totalCount,
      reconciledCount: 0,
      unreconciledCount,
      invalidCount,
      rowsProcessed: totalCount,
      rowsInserted,
      rowsFailed,
    };
    run.status = 'MATCHING';
    run.progress = 60;
    await run.save();
    await job.updateProgress(60);

    // 3. Execute reconciliation matching algorithm
    console.log(`[WORKER] Running matching service for runId: ${runId}`);
    const matchResult = await runReconciliation(runId);

    // Update run status to REPORTING
    run.summary = {
      ...run.summary,
      ...matchResult.summary,
    };
    run.status = 'REPORTING';
    run.progress = 85;
    await run.save();
    await job.updateProgress(85);

    // 4. Generate CSV and JSON reports and save to reports/
    console.log(`[WORKER] Generating and storing reports for runId: ${runId}`);
    const reportResult = await generateReportsForRun(runId);
    await job.updateProgress(100);

    // 5. Complete reconciliation run lifecycle
    console.log(`[WORKER] Matching job ${job.id} completed successfully for runId: ${runId}`);
    await reconciliationRunRepository.completeRun(run._id, run.summary, 'COMPLETED');

    return {
      runId,
      summary: run.summary,
      files: reportResult.files,
    };
  } catch (err) {
    console.error(`[WORKER] Job ${job.id} execution failed:`, err);
    // Fail the run inside DB immediately on catch
    const run = await reconciliationRunRepository.findByRunId(runId);
    if (run) {
      run.status = 'FAILED';
      run.completedAt = new Date();
      run.summary = { ...run.summary, errorMessage: err.message };
      await run.save();
    }
    throw err;
  }
};

/**
 * Initializes and starts the BullMQ background worker.
 */
export const startReconciliationWorker = () => {
  if (process.env.USE_IN_PROCESS_QUEUE === 'true') {
    return null;
  }

  const worker = new Worker(
    'reconciliation-jobs',
    async (job) => {
      return processReconciliationRun(job);
    },
    {
      connection,
      concurrency: 1, // Processes one reconciliation run at a time
    }
  );

  worker.on('failed', async (job, err) => {
    console.error(`[WORKER] Job ${job?.id} failed with error:`, err);
    if (job?.data?.runId) {
      // Mark run as FAILED and log error message
      const run = await reconciliationRunRepository.findByRunId(job.data.runId);
      if (run) {
        run.status = 'FAILED';
        run.completedAt = new Date();
        run.summary = { ...run.summary, errorMessage: err.message };
        await run.save();
      }
    }
  });

  return worker;
};

export default startReconciliationWorker;
