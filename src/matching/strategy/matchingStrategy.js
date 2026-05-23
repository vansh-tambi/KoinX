import tolerances from '../../config/tolerances.js';

/**
 * Checks if two transactions match based on amount and date tolerances.
 * 
 * @param {Object} tx1 - First transaction (e.g. from user records).
 * @param {Object} tx2 - Second transaction (e.g. from exchange records).
 * @returns {{ isMatch: boolean, discrepancyType?: string, severity?: string, details?: Object }}
 */
export const compareTransactions = (tx1, tx2) => {
  // 1. Check basic identity or external reference matching
  const hasRefMatch = tx1.externalId === tx2.externalId;
  
  // 2. Check type alignment (both Credit or both Debit)
  const hasTypeMatch = tx1.type === tx2.type;
  
  // 3. Check amount difference within tolerance
  const amountDiff = Math.abs(tx1.amount - tx2.amount);
  const isAmountWithinTolerance = amountDiff <= tolerances.amountDifference;
  
  // 4. Check date window within tolerance
  const timeDiffMs = Math.abs(tx1.transactionDate.getTime() - tx2.transactionDate.getTime());
  const isDateWithinTolerance = timeDiffMs <= (tolerances.dateWindowSeconds * 1000);

  if (hasRefMatch && hasTypeMatch && isAmountWithinTolerance && isDateWithinTolerance) {
    return { isMatch: true };
  }

  // Identify discrepancy if partially matched
  if (hasRefMatch) {
    if (!hasTypeMatch) {
      return {
        isMatch: false,
        discrepancyType: 'STATUS_MISMATCH',
        severity: 'HIGH',
        details: { tx1Type: tx1.type, tx2Type: tx2.type }
      };
    }
    if (!isAmountWithinTolerance) {
      return {
        isMatch: false,
        discrepancyType: 'AMOUNT_MISMATCH',
        severity: 'MEDIUM',
        details: { tx1Amount: tx1.amount, tx2Amount: tx2.amount, difference: amountDiff }
      };
    }
    if (!isDateWithinTolerance) {
      return {
        isMatch: false,
        discrepancyType: 'DATE_MISMATCH',
        severity: 'LOW',
        details: { tx1Date: tx1.transactionDate, tx2Date: tx2.transactionDate, differenceSeconds: timeDiffMs / 1000 }
      };
    }
  }

  return { isMatch: false };
};

export default compareTransactions;
