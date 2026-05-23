import { Queue } from 'bullmq';
import redisConfig from '../config/redis.js';

const connection = {
  host: redisConfig.host,
  port: redisConfig.port,
};

export const reconciliationQueue = new Queue('reconciliation-jobs', {
  connection,
});

/**
 * Adds a new reconciliation job to the queue.
 * 
 * @param {string} runId - ReconciliationRun ID.
 * @param {string} userFile - Path to the user transactions CSV file.
 * @param {string} exchangeFile - Path to the exchange transactions CSV file.
 * @param {Object} [options] - BullMQ job options.
 * @returns {Promise<Object>} The added BullMQ job.
 */
export const queueReconciliationJob = async (runId, userFile, exchangeFile, options = {}) => {
  return reconciliationQueue.add(
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

export default { reconciliationQueue, queueReconciliationJob };
