import BaseRepository from './baseRepository.js';
import ReconciliationReport from '../models/reconciliationReport.js';

class ReconciliationReportRepository extends BaseRepository {
  constructor() {
    super(ReconciliationReport);
  }

  /**
   * Find reports generated for a specific reconciliation run.
   * @param {string} runId 
   * @returns {Promise<Array<Object>>}
   */
  async findByRunId(runId) {
    return this.findAll({ runId });
  }
}

const reconciliationReportRepositoryInstance = new ReconciliationReportRepository();

export default {
  findAll: (filter, options) => reconciliationReportRepositoryInstance.findAll(filter, options),
  findById: (id, populate) => reconciliationReportRepositoryInstance.findById(id, populate),
  create: (data) => reconciliationReportRepositoryInstance.create(data),
  update: (id, data, options) => reconciliationReportRepositoryInstance.update(id, data, options),
  delete: (id) => reconciliationReportRepositoryInstance.delete(id),
  findByRunId: (runId) => reconciliationReportRepositoryInstance.findByRunId(runId),
  count: (filter) => reconciliationReportRepositoryInstance.count(filter),
  instance: reconciliationReportRepositoryInstance,
};
