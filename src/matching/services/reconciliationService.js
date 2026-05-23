import transactionRepository from '../../repositories/transactionRepository.js';
import reconciliationRunRepository from '../../repositories/reconciliationRunRepository.js';
import reconciliationReportRepository from '../../repositories/reconciliationReportRepository.js';
import Transaction from '../../models/transaction.js';
import { calculateMatchScore } from '../strategy/matchingStrategy.js';
import tolerances from '../../config/tolerances.js';

/**
 * Executes the two-pass reconciliation flow over ingested transactions.
 * 
 * @param {string} runId - The runId matching the ReconciliationRun.
 * @returns {Promise<Object>} Summary statistics of the matching run.
 */
export const runReconciliation = async (runId) => {
  // Fetch ReconciliationRun metadata
  const run = await reconciliationRunRepository.findByRunId(runId);
  if (!run) {
    throw new Error(`ReconciliationRun not found with runId: ${runId}`);
  }

  // Extract run-specific matching tolerances from configurations
  const customTolerances = {
    timestampToleranceSeconds: run.config?.timestampTolerance,
    quantityTolerancePct: run.config?.quantityTolerance,
  };

  // Retrieve all valid, unreconciled transactions for this run
  const userTxs = await transactionRepository.findAll({
    runId,
    source: 'USER',
    'ingestionStatus.valid': true,
    reconciliationStatus: 'UNRECONCILED',
  });

  const exchangeTxs = await transactionRepository.findAll({
    runId,
    source: 'EXCHANGE',
    'ingestionStatus.valid': true,
    reconciliationStatus: 'UNRECONCILED',
  });

  const matchedTxIds = new Set();
  const reportsToCreate = [];
  const reconciledTxIds = [];
  const failedTxIds = [];

  let countMatched = 0;
  let countConflicting = 0;

  // Map exchange transactions by txId for fast lookup during Pass 1
  const exchangeMap = new Map();
  for (const tx of exchangeTxs) {
    if (tx.normalized.txId) {
      exchangeMap.set(tx.normalized.txId, tx);
    }
  }

  // ==========================================
  // PASS 1: ID-Based Matching
  // ==========================================
  for (const userTx of userTxs) {
    const txId = userTx.normalized.txId;
    if (!txId) continue;

    const exchangeTx = exchangeMap.get(txId);
    if (exchangeTx) {
      // Pass the custom tolerances override
      const matchResult = calculateMatchScore(userTx, exchangeTx, customTolerances);

      if (matchResult.isMatch) {
        // High confidence match confirmed
        countMatched++;
        matchedTxIds.add(userTx._id);
        matchedTxIds.add(exchangeTx._id);
        
        reconciledTxIds.push(userTx._id);
        reconciledTxIds.push(exchangeTx._id);

        reportsToCreate.push({
          runId,
          category: 'matched',
          confidence: matchResult.confidence,
          userTx: userTx._id,
          exchangeTx: exchangeTx._id,
          reason: matchResult.reason,
        });
      } else {
        // ID matches but details conflict (discrepancy)
        countConflicting++;
        matchedTxIds.add(userTx._id);
        matchedTxIds.add(exchangeTx._id);

        failedTxIds.push(userTx._id);
        failedTxIds.push(exchangeTx._id);

        reportsToCreate.push({
          runId,
          category: 'conflicting',
          confidence: matchResult.confidence,
          userTx: userTx._id,
          exchangeTx: exchangeTx._id,
          reason: matchResult.reason,
        });
      }
    }
  }

  // Filter remaining unmatched transaction lists for Pass 2
  const unmatchedUserList = userTxs.filter(tx => !matchedTxIds.has(tx._id));
  const unmatchedExchangeList = exchangeTxs.filter(tx => !matchedTxIds.has(tx._id));

  // ==========================================
  // PASS 2: Proximity Matching (Weighted scoring)
  // ==========================================
  
  // Resolve current timestamp tolerance limit
  const timestampToleranceLimit = customTolerances.timestampToleranceSeconds ?? tolerances.timestampToleranceSeconds;

  // Step 1: Group unmatched Exchange transactions by asset
  const exchangeAssetGroups = new Map();
  for (const tx of unmatchedExchangeList) {
    const asset = tx.normalized.asset;
    if (!exchangeAssetGroups.has(asset)) {
      exchangeAssetGroups.set(asset, []);
    }
    exchangeAssetGroups.get(asset).push(tx);
  }

  // Step 2: Sort each asset bucket by timestamp ascending
  for (const bucket of exchangeAssetGroups.values()) {
    bucket.sort((a, b) => a.normalized.timestamp.getTime() - b.normalized.timestamp.getTime());
  }

  // Binary search helper to find the first index in arr where timestamp is >= targetTimeMs
  const findFirstIndexInRange = (arr, targetTimeMs) => {
    let low = 0;
    let high = arr.length - 1;
    let result = arr.length;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midTime = arr[mid].normalized.timestamp.getTime();

      if (midTime >= targetTimeMs) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return result;
  };

  // Step 3 & 4: Process user transactions using binary search and targeted scoring
  for (const userTx of unmatchedUserList) {
    const asset = userTx.normalized.asset;
    const bucket = exchangeAssetGroups.get(asset);
    if (!bucket || bucket.length === 0) continue;

    const userTimeMs = userTx.normalized.timestamp.getTime();
    const lowerBoundMs = userTimeMs - timestampToleranceLimit * 1000;
    const upperBoundMs = userTimeMs + timestampToleranceLimit * 1000;

    // Binary search for first exchange transaction starting within timestamp tolerance window
    const startIndex = findFirstIndexInRange(bucket, lowerBoundMs);

    let bestExchangeTx = null;
    let highestConfidence = 0;
    let bestReason = '';

    // Iterate forward through sorted candidate list inside window
    for (let i = startIndex; i < bucket.length; i++) {
      const exchangeTx = bucket[i];
      const exchangeTimeMs = exchangeTx.normalized.timestamp.getTime();

      // Exceeded upper bound of timestamp tolerance window; stop searching
      if (exchangeTimeMs > upperBoundMs) {
        break;
      }

      // Skip already matched exchange transactions
      if (matchedTxIds.has(exchangeTx._id)) {
        continue;
      }

      // Calculate match score
      const scoreResult = calculateMatchScore(userTx, exchangeTx, customTolerances);

      if (scoreResult.isMatch && scoreResult.confidence > highestConfidence) {
        highestConfidence = scoreResult.confidence;
        bestExchangeTx = exchangeTx;
        bestReason = scoreResult.reason;
      }
    }

    // Lock in the best match
    if (bestExchangeTx) {
      countMatched++;
      matchedTxIds.add(userTx._id);
      matchedTxIds.add(bestExchangeTx._id);

      reconciledTxIds.push(userTx._id);
      reconciledTxIds.push(bestExchangeTx._id);

      reportsToCreate.push({
        runId,
        category: 'matched',
        confidence: highestConfidence,
        userTx: userTx._id,
        exchangeTx: bestExchangeTx._id,
        reason: `Pass 2 Proximity Match: ${bestReason}`,
      });
    }
  }

  // ==========================================
  // Post-Matching: Unmatched Records Logging
  // ==========================================
  const finalUnmatchedUser = userTxs.filter(tx => !matchedTxIds.has(tx._id));
  const finalUnmatchedExchange = exchangeTxs.filter(tx => !matchedTxIds.has(tx._id));

  for (const tx of finalUnmatchedUser) {
    failedTxIds.push(tx._id);
    reportsToCreate.push({
      runId,
      category: 'unmatched_user',
      confidence: 1.0,
      userTx: tx._id,
      exchangeTx: null,
      reason: 'No matching exchange transaction found by ID or proximity window.',
    });
  }

  for (const tx of finalUnmatchedExchange) {
    failedTxIds.push(tx._id);
    reportsToCreate.push({
      runId,
      category: 'unmatched_exchange',
      confidence: 1.0,
      userTx: null,
      exchangeTx: tx._id,
      reason: 'No matching user transaction found by ID or proximity window.',
    });
  }

  // ==========================================
  // Database Updates & Complete Run
  // ==========================================
  
  // 1. Bulk insert generated reports
  if (reportsToCreate.length > 0) {
    const reportOperations = reportsToCreate.map(doc => ({
      insertOne: { document: doc }
    }));
    await reconciliationReportRepository.instance.bulkWrite(reportOperations);
  }

  // 2. Bulk update transaction statuses
  if (reconciledTxIds.length > 0) {
    await Transaction.updateMany(
      { _id: { $in: reconciledTxIds } },
      { reconciliationStatus: 'RECONCILED' }
    );
  }
  if (failedTxIds.length > 0) {
    await Transaction.updateMany(
      { _id: { $in: failedTxIds } },
      { reconciliationStatus: 'FAILED' }
    );
  }

  // 3. Compile summary counters
  const totalProcessed = userTxs.length + exchangeTxs.length;
  const summary = {
    totalTransactions: totalProcessed,
    matchedCount: countMatched * 2, // 2 records per pair
    conflictingCount: countConflicting * 2, // 2 records per pair
    unmatchedUserCount: finalUnmatchedUser.length,
    unmatchedExchangeCount: finalUnmatchedExchange.length,
  };

  return {
    success: true,
    runId,
    summary,
  };
};

export default { runReconciliation };
