import { Worker } from 'bullmq';
import redisConfig from '../config/redis.js';
import { runReconciliation } from '../matching/services/reconciliationService.js';

const connection = {
  host: redisConfig.host,
  port: redisConfig.port,
};

/**
 * Initializes and starts the BullMQ worker.
 */
export const startReconciliationWorker = () => {
  const worker = new Worker(
    'reconciliation-jobs',
    async (job) => {
      console.log(`Processing job ${job.id} for run ${job.data.runId}...`);
      try {
        const report = await runReconciliation(job.data.runId);
        console.log(`Job ${job.id} completed. Report generated: ${report._id}`);
        return { reportId: report._id };
      } catch (err) {
        console.error(`Error processing job ${job.id}:`, err);
        throw err;
      }
    },
    {
      connection,
      concurrency: 1, // Process one reconciliation job at a time
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed with error:`, err);
  });

  return worker;
};

export default startReconciliationWorker;
