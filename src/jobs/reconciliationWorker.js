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
 * Initializes and starts the BullMQ background worker.
 * Orchestrates the full async pipeline: Ingest User CSV + Ingest Exchange CSV + Reconciliation Matching + Exporter.
 */
export const startReconciliationWorker = () => {
  const worker = new Worker(
    'reconciliation-jobs',
    async (job) => {
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
        run.summary = {
          totalCount: 0,
          reconciledCount: 0,
          unreconciledCount: 0,
          invalidCount: 0,
        };
        await run.save();
        await job.updateProgress(10);

        // 2. Ingest CSV files
        console.log(`[WORKER] Ingesting User file: ${userFile}`);
        const userResult = await ingestCsvFile(userFile, runId, 'USER');
        await job.updateProgress(30);

        console.log(`[WORKER] Ingesting Exchange file: ${exchangeFile}`);
        const exchangeResult = await ingestCsvFile(exchangeFile, runId, 'EXCHANGE');
        await job.updateProgress(50);

        // Update run status with ingestion metrics and transition to MATCHING
        const totalCount = userResult.totalRows + exchangeResult.totalRows;
        const unreconciledCount = userResult.validRows + exchangeResult.validRows;
        const invalidCount = userResult.invalidRows + exchangeResult.invalidRows;
        
        run.summary = {
          totalCount,
          reconciledCount: 0,
          unreconciledCount,
          invalidCount,
        };
        run.status = 'MATCHING';
        await run.save();

        // 3. Execute reconciliation matching algorithm
        console.log(`[WORKER] Running matching service for runId: ${runId}`);
        const matchResult = await runReconciliation(runId);
        await job.updateProgress(80);

        // Update run status to REPORTING
        run.summary = {
          ...run.summary,
          ...matchResult.summary,
        };
        run.status = 'REPORTING';
        await run.save();

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
