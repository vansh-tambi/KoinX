import { stringify } from 'csv-stringify/sync';

/**
 * Generates an exportable CSV string of all discrepancies in a report.
 * 
 * @param {Object} report - ReconciliationReport document.
 * @returns {string} The CSV formatted report file content.
 */
export const generateDiscrepancyCsv = (report) => {
  if (!report || !report.discrepancies || report.discrepancies.length === 0) {
    return 'transactionId,type,severity,details\n';
  }

  const rows = report.discrepancies.map((d) => ({
    transactionId: d.transactionId,
    type: d.type,
    severity: d.severity,
    details: JSON.stringify(d.details),
  }));

  return stringify(rows, {
    header: true,
    columns: ['transactionId', 'type', 'severity', 'details'],
  });
};

export default { generateDiscrepancyCsv };
