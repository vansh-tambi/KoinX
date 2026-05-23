import BaseRepository from './baseRepository.js';
import ReconciliationRun from '../models/reconciliationRun.js';

class ReconciliationRunRepository extends BaseRepository {
  constructor() {
    super(ReconciliationRun);
  }

  /**
   * Find a run by its unique runId.
   * @param {string} runId 
   * @returns {Promise<Object|null>}
   */
  async findByRunId(runId) {
    return this.findOne({ runId });
  }

  /**
   * Update summary and status for a completed/failed reconciliation run.
   * @param {string} id 
   * @param {Object} summary - run outcome counts/details
   * @param {string} [status] - COMPLETED or FAILED
   * @returns {Promise<Object|null>}
   */
  async completeRun(id, summary, status = 'COMPLETED') {
    const run = await this.model.findById(id);
    if (!run) return null;
    run.status = status.toUpperCase();
    run.completedAt = new Date();
    run.summary = summary;
    run.progress = 100;
    return run.save();
  }
}

const reconciliationRunRepositoryInstance = new ReconciliationRunRepository();

export default {
  findAll: (filter, options) => reconciliationRunRepositoryInstance.findAll(filter, options),
  findById: (id, populate) => reconciliationRunRepositoryInstance.findById(id, populate),
  create: (data) => reconciliationRunRepositoryInstance.create(data),
  update: (id, data, options) => reconciliationRunRepositoryInstance.update(id, data, options),
  delete: (id) => reconciliationRunRepositoryInstance.delete(id),
  findByRunId: (runId) => reconciliationRunRepositoryInstance.findByRunId(runId),
  completeRun: (id, summary, status) => reconciliationRunRepositoryInstance.completeRun(id, summary, status),
  instance: reconciliationRunRepositoryInstance,
};
