/**
 * Validates a single transaction row parsed from CSV data.
 * Does not throw exceptions; instead collects all issues to comply with "never drop rows".
 * 
 * @param {Object} row - Raw CSV record.
 * @param {Set<string>} processedTxIds - Tracks transaction IDs already parsed in this run/source.
 * @returns {{ valid: boolean, issues: string[] }}
 */
export const validateTransactionRow = (row, processedTxIds) => {
  const issues = [];

  // 1. Check for missing required fields
  const requiredFields = ['transaction_id', 'timestamp', 'type', 'asset', 'quantity'];
  for (const field of requiredFields) {
    if (row[field] === undefined || row[field] === null || String(row[field]).trim() === '') {
      issues.push(`Missing required field: ${field}`);
    }
  }

  // 2. Check for invalid timestamps
  if (row.timestamp !== undefined && row.timestamp !== null && String(row.timestamp).trim() !== '') {
    const dateVal = new Date(row.timestamp);
    if (isNaN(dateVal.getTime())) {
      issues.push(`Invalid timestamp format: "${row.timestamp}"`);
    }
  }

  // 3. Check for invalid quantity and fee values
  if (row.quantity !== undefined && row.quantity !== null && String(row.quantity).trim() !== '') {
    const qty = Number(row.quantity);
    if (isNaN(qty)) {
      issues.push(`Quantity must be a valid number: "${row.quantity}"`);
    } else if (qty <= 0) {
      issues.push(`Quantity must be positive: "${row.quantity}"`);
    }
  }

  if (row.fee !== undefined && row.fee !== null && String(row.fee).trim() !== '') {
    const feeVal = Number(row.fee);
    if (isNaN(feeVal)) {
      issues.push(`Fee must be a valid number: "${row.fee}"`);
    } else if (feeVal < 0) {
      issues.push(`Fee must be non-negative: "${row.fee}"`);
    }
  }

  // 4. Check for duplicate txIds within this file run
  if (row.transaction_id !== undefined && row.transaction_id !== null && String(row.transaction_id).trim() !== '') {
    const txId = String(row.transaction_id).trim();
    if (processedTxIds.has(txId)) {
      issues.push(`Duplicate transaction ID within run: "${txId}"`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
};

export default validateTransactionRow;
