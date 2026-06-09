import { Queue } from 'bullmq';
import redisConfig from '../config/redis.js';
import { processReconciliationRun } from './reconciliationWorker.js';
import reconciliationRunRepository from '../repositories/reconciliationRunRepository.js';

const connection = {
  host: redisConfig.host,
  port: redisConfig.port,
};

let reconciliationQueue = null;

export const getReconciliationQueue = () => {
  if (process.env.USE_IN_PROCESS_QUEUE === 'true') {
    return null;
  }
  if (!reconciliationQueue) {
    reconciliationQueue = new Queue('reconciliation-jobs', {
      connection,
    });
  }
  return reconciliationQueue;
};

/**
 * Adds a new reconciliation job to the queue.
 * 
 * @param {string} runId - ReconciliationRun ID.
 * @param {string} userFile - Path to the user transactions CSV file.
 * @param {string} exchangeFile - Path to the exchange transactions CSV file.
 * @param {Object} [options] - BullMQ job options.
 * @returns {Promise<Object>} The added BullMQ job or mock job info.
 */
export const queueReconciliationJob = async (runId, userFile, exchangeFile, options = {}) => {
  if (process.env.USE_IN_PROCESS_QUEUE === 'true') {
    console.log(`[QUEUE] Redis offline. Executing in-process async worker for runId: ${runId}`);
    
    // Simulate background worker execution asynchronously
    setImmediate(async () => {
      try {
        const mockJob = {
          id: `in-process-${Date.now()}`,
          data: { runId, userFile, exchangeFile },
          updateProgress: async (progress) => {
            const run = await reconciliationRunRepository.findByRunId(runId);
            if (run) {
              run.progress = progress;
              await run.save();
            }
          }
        };
        await processReconciliationRun(mockJob);
      } catch (err) {
        console.error(`[MOCK WORKER] In-process execution failed for runId: ${runId}`, err);
      }
    });

    return { id: `in-process-job-${Date.now()}` };
  }

  const queue = getReconciliationQueue();
  return queue.add(
    'process-run', 
    { runId, userFile, exchangeFile }, 
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      ...options,
    }
  );
};

export default { getReconciliationQueue, queueReconciliationJob };
