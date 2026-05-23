import BaseRepository from './baseRepository.js';
import Transaction from '../models/transaction.js';

class TransactionRepository extends BaseRepository {
  constructor() {
    super(Transaction);
  }

  /**
   * Find a transaction by provider and externalId.
   * @param {string} provider 
   * @param {string} externalId 
   * @returns {Promise<Object|null>}
   */
  async findByExternalId(provider, externalId) {
    return this.findOne({ 
      provider: provider.toUpperCase(), 
      externalId 
    });
  }

  /**
   * Update reconciliation status for a transaction.
   * @param {string} id 
   * @param {string} status 
   * @param {string} [runId] 
   * @returns {Promise<Object|null>}
   */
  async updateReconciliation(id, status, runId = null) {
    return this.update(id, {
      reconciliationStatus: status.toUpperCase(),
      reconciliationRunId: runId
    });
  }
}

const transactionRepositoryInstance = new TransactionRepository();

// Backward compatible functions matching current transactionService.js usages
export const findAll = (filter, options) => transactionRepositoryInstance.findAll(filter, options);
export const findById = (id, populate) => transactionRepositoryInstance.findById(id, populate);
export const create = (data) => transactionRepositoryInstance.create(data);
export const update = (id, data, options) => transactionRepositoryInstance.update(id, data, options);
export const deleteDoc = (id) => transactionRepositoryInstance.delete(id);

export default {
  findAll,
  findById,
  create,
  update,
  delete: deleteDoc,
  findByExternalId: (provider, externalId) => transactionRepositoryInstance.findByExternalId(provider, externalId),
  updateReconciliation: (id, status, runId) => transactionRepositoryInstance.updateReconciliation(id, status, runId),
  instance: transactionRepositoryInstance,
};
