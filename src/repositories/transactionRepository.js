import BaseRepository from './baseRepository.js';
import Transaction from '../models/transaction.js';

class TransactionRepository extends BaseRepository {
  constructor() {
    super(Transaction);
  }

  /**
   * Find a transaction by its runId, source, and normalized transaction ID.
   * @param {string} runId 
   * @param {string} source - USER or EXCHANGE
   * @param {string} txId 
   * @returns {Promise<Object|null>}
   */
  async findByTxId(runId, source, txId) {
    return this.findOne({ 
      runId,
      source: source.toUpperCase(), 
      'normalized.txId': txId 
    });
  }

  /**
   * Update reconciliation status for a transaction.
   * @param {string} id 
   * @param {string} status 
   * @returns {Promise<Object|null>}
   */
  async updateReconciliation(id, status) {
    return this.update(id, {
      reconciliationStatus: status.toUpperCase()
    });
  }
}

const transactionRepositoryInstance = new TransactionRepository();

// Backward compatible functions matching standard services
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
  findByTxId: (runId, source, txId) => transactionRepositoryInstance.findByTxId(runId, source, txId),
  updateReconciliation: (id, status) => transactionRepositoryInstance.updateReconciliation(id, status),
  instance: transactionRepositoryInstance,
};
