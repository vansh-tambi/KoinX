import transactionRepository from '../../repositories/transactionRepository.js';
import reconciliationRunRepository from '../../repositories/reconciliationRunRepository.js';
import reconciliationReportRepository from '../../repositories/reconciliationReportRepository.js';
import compareTransactions from '../strategy/matchingStrategy.js';

/**
 * Executes a reconciliation process matching User vs Exchange transactions.
 * 
 * @param {string} runId - The ID of the ReconciliationRun tracking this job.
 * @returns {Promise<Object>} The summary report details.
 */
export const runReconciliation = async (runId) => {
  // Retrieve the run details
  const run = await reconciliationRunRepository.findById(runId);
  if (!run) {
    throw new Error(`ReconciliationRun not found with ID ${runId}`);
  }

  // Business logic placeholder
  // A production pipeline would query transactions, apply the comparison matching strategy,
  // group unmatched items as discrepancies, and compile aggregates.
  
  // Update run metadata
  await reconciliationRunRepository.completeRun(runId, {
    totalCount: 0,
    reconciledCount: 0,
    unreconciledCount: 0
  });

  // Create report stub
  const report = await reconciliationReportRepository.create({
    runId,
    name: `Report for run ${run.runNumber}`,
    type: 'AD_HOC',
    status: 'DRAFT',
    summary: {
      totalTransactions: 0,
      matchedTransactions: 0,
      mismatchedTransactions: 0,
      totalAmountReconciled: 0,
      totalAmountMismatched: 0,
      currency: 'USD'
    },
    discrepancies: []
  });

  return report;
};

export default { runReconciliation };
