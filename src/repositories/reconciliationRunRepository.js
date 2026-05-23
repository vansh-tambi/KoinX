import BaseRepository from './baseRepository.js';
import ReconciliationRun from '../models/reconciliationRun.js';

class ReconciliationRunRepository extends BaseRepository {
  constructor() {
    super(ReconciliationRun);
  }

  /**
   * Find a run by its unique run number.
   * @param {string} runNumber 
   * @returns {Promise<Object|null>}
   */
  async findByRunNumber(runNumber) {
    return this.findOne({ runNumber });
  }

  /**
   * Update metrics and status for a completed/failed reconciliation run.
   * @param {string} id 
   * @param {Object} metrics - counts of records processed
   * @param {number} metrics.totalCount
   * @param {number} metrics.reconciledCount
   * @param {number} metrics.unreconciledCount
   * @param {string} [status] - COMPLETED or FAILED
   * @param {string} [errorMessage] - Optional error details
   * @returns {Promise<Object|null>}
   */
  async completeRun(id, metrics, status = 'COMPLETED', errorMessage = null) {
    return this.update(id, {
      status: status.toUpperCase(),
      completedAt: new Date(),
      totalCount: metrics.totalCount,
      reconciledCount: metrics.reconciledCount,
      unreconciledCount: metrics.unreconciledCount,
      errorMessage
    });
  }
}

const reconciliationRunRepositoryInstance = new ReconciliationRunRepository();

export default {
  findAll: (filter, options) => reconciliationRunRepositoryInstance.findAll(filter, options),
  findById: (id, populate) => reconciliationRunRepositoryInstance.findById(id, populate),
  create: (data) => reconciliationRunRepositoryInstance.create(data),
  update: (id, data, options) => reconciliationRunRepositoryInstance.update(id, data, options),
  delete: (id) => reconciliationRunRepositoryInstance.delete(id),
  findByRunNumber: (runNumber) => reconciliationRunRepositoryInstance.findByRunNumber(runNumber),
  completeRun: (id, metrics, status, errorMessage) => reconciliationRunRepositoryInstance.completeRun(id, metrics, status, errorMessage),
  instance: reconciliationRunRepositoryInstance,
};
