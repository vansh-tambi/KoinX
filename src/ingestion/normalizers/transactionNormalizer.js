const ASSET_ALIASES = {
  'BITCOIN': 'BTC',
  'ETHEREUM': 'ETH',
  'SOLANA': 'SOL',
};

/**
 * Normalizes parsed CSV transaction row fields.
 * Trims strings, converts type and asset to uppercase, maps crypto asset aliases, and parses dates to UTC.
 * 
 * @param {Object} row - The raw CSV row object.
 * @returns {Object} Standardized fields representing the nested normalized schema.
 */
export const normalizeTransactionRow = (row) => {
  const txId = (row.transaction_id || '').trim();
  const rawType = (row.type || '').trim().toUpperCase();
  
  // Normalize asset name and resolve aliases
  const rawAsset = (row.asset || '').trim().toUpperCase();
  const asset = ASSET_ALIASES[rawAsset] || rawAsset;

  // Safely parse quantity and fee to numbers
  const quantity = row.quantity && !isNaN(Number(row.quantity)) ? Number(row.quantity) : 0;
  const fee = row.fee && !isNaN(Number(row.fee)) ? Number(row.fee) : 0;

  // Safely parse date to UTC
  let timestamp = null;
  if (row.timestamp && String(row.timestamp).trim() !== '') {
    const dateVal = new Date(row.timestamp);
    if (!isNaN(dateVal.getTime())) {
      timestamp = dateVal;
    }
  }

  return {
    txId,
    timestamp,
    type: rawType,
    asset,
    quantity,
    fee,
  };
};

export default normalizeTransactionRow;
