import { stringify } from 'csv-stringify/sync';

/**
 * Transforms populated Mongoose ReconciliationReport documents into flat JSON objects.
 * Matches specific user and exchange CSV column requirements.
 * 
 * @param {Array<Object>} reports - List of populated report documents.
 * @returns {Array<Object>} Flat list of report objects.
 */
export const formatReportToFlatList = (reports) => {
  return (reports || []).map((report) => {
    // Safely extract nested user and exchange transaction details
    const user = report.userTx && typeof report.userTx === 'object' ? report.userTx : {};
    const exchange = report.exchangeTx && typeof report.exchangeTx === 'object' ? report.exchangeTx : {};

    const userNorm = user.normalized || {};
    const exchangeNorm = exchange.normalized || {};

    return {
      category: report.category || '',
      confidence: report.confidence !== undefined ? report.confidence : '',
      reason: report.reason || '',
      user_txId: userNorm.txId || '',
      user_timestamp: userNorm.timestamp ? new Date(userNorm.timestamp).toISOString() : '',
      user_asset: userNorm.asset || '',
      user_quantity: userNorm.quantity !== undefined ? userNorm.quantity : '',
      exchange_txId: exchangeNorm.txId || '',
      exchange_timestamp: exchangeNorm.timestamp ? new Date(exchangeNorm.timestamp).toISOString() : '',
      exchange_asset: exchangeNorm.asset || '',
      exchange_quantity: exchangeNorm.quantity !== undefined ? exchangeNorm.quantity : '',
    };
  });
};

/**
 * Converts a flat list of report records into a CSV formatted string.
 * Enforces the exact column order requested.
 * 
 * @param {Array<Object>} flatReports - List of flat report records.
 * @returns {string} The CSV content.
 */
export const convertToCsv = (flatReports) => {
  return stringify(flatReports, {
    header: true,
    columns: [
      'category',
      'confidence',
      'reason',
      'user_txId',
      'user_timestamp',
      'user_asset',
      'user_quantity',
      'exchange_txId',
      'exchange_timestamp',
      'exchange_asset',
      'exchange_quantity'
    ],
  });
};

export default { formatReportToFlatList, convertToCsv };
