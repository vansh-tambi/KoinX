const CURRENCY_ALIASES = {
  'US-DOLLAR': 'USD',
  'DOLLAR': 'USD',
  'TETHER': 'USDT',
  'TETHER USD': 'USDT',
  'BITCOIN': 'BTC',
  'ETHER': 'ETH',
  'ETHEREUM': 'ETH',
};

const TYPE_MAPPING = {
  'DEPOSIT': 'CREDIT',
  'PAY': 'CREDIT',
  'IN': 'CREDIT',
  'CREDIT': 'CREDIT',
  'WITHDRAW': 'DEBIT',
  'CHARGE': 'DEBIT',
  'OUT': 'DEBIT',
  'DEBIT': 'DEBIT',
  'PAYMENT': 'DEBIT',
  'REFUND': 'REFUND',
  'REIMBURSEMENT': 'REFUND',
  'CHARGEBACK': 'CHARGEBACK',
  'DISPUTE': 'CHARGEBACK',
};

/**
 * Standardizes currency/asset codes based on aliases.
 * @param {string} currency 
 * @returns {string}
 */
export const normalizeCurrency = (currency) => {
  const upper = (currency || '').toUpperCase().trim();
  return CURRENCY_ALIASES[upper] || upper;
};

/**
 * Maps transaction types to standard enums.
 * @param {string} type 
 * @returns {string}
 */
export const normalizeType = (type) => {
  const upper = (type || '').toUpperCase().trim();
  return TYPE_MAPPING[upper] || 'DEBIT'; // fallback to standard DEBIT
};

/**
 * Normalizes date input to a UTC Date object.
 * @param {string|Date} dateVal 
 * @returns {Date}
 */
export const normalizeDate = (dateVal) => {
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date format: ${dateVal}`);
  }
  return d;
};

/**
 * Integrates all field normalizations into a single record object.
 * 
 * @param {Object} data - Validated row data.
 * @returns {Object} Normalized transaction data.
 */
export const normalizeTransaction = (data) => {
  const currency = normalizeCurrency(data.currency);
  const type = normalizeType(data.type);
  const transactionDate = normalizeDate(data.transactionDate);
  const amount = Math.abs(Number(data.amount));

  return {
    externalId: (data.externalId || '').trim(),
    provider: (data.provider || '').toUpperCase().trim(),
    type,
    status: (data.status || '').toUpperCase().trim(),
    amount,
    currency,
    normalizedAmount: amount, // Simplified: base currency conversion can happen here
    normalizedCurrency: 'USD',
    transactionDate,
  };
};

export default normalizeTransaction;
