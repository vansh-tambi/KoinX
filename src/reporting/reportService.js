import fs from 'fs/promises';
import path from 'path';
import reconciliationReportRepository from '../repositories/reconciliationReportRepository.js';
import reconciliationRunRepository from '../repositories/reconciliationRunRepository.js';
import { formatReportToFlatList, convertToCsv } from './reportGenerator.js';

/**
 * Loads reconciliation reports for a specific runId, flattens them, generates
 * JSON/CSV files, saves them to reports/ folder, and returns summary stats.
 * 
 * @param {string} runId - The runId matching the ReconciliationRun.
 * @returns {Promise<Object>} Execution summary containing generated file paths.
 */
export const generateReportsForRun = async (runId) => {
  // 1. Fetch ReconciliationRun metrics metadata
  const run = await reconciliationRunRepository.findByRunId(runId);
  if (!run) {
    throw new Error(`ReconciliationRun not found with runId: ${runId}`);
  }

  // 2. Fetch all report documents, populating transactional user and exchange records
  const reports = await reconciliationReportRepository.findAll(
    { runId },
    { populate: ['userTx', 'exchangeTx'] }
  );

  // 3. Format reports to flat list matching requested columns
  const flatReports = formatReportToFlatList(reports);

  // 4. Generate JSON and CSV content
  const jsonContent = JSON.stringify({
    runId,
    status: run.status,
    summary: run.summary || {},
    generatedAt: new Date().toISOString(),
    reports: flatReports,
  }, null, 2);

  const csvContent = convertToCsv(flatReports);

  // 5. Establish storage locations under reports/
  const reportsDir = path.resolve('reports');
  const jsonPath = path.join(reportsDir, `report_${runId}.json`);
  const csvPath = path.join(reportsDir, `report_${runId}.csv`);

  // Ensure reports/ directory exists
  await fs.mkdir(reportsDir, { recursive: true });

  // 6. Write files to reports/ directory
  await fs.writeFile(jsonPath, jsonContent, 'utf-8');
  await fs.writeFile(csvPath, csvContent, 'utf-8');

  return {
    success: true,
    runId,
    summary: run.summary || {},
    files: {
      json: jsonPath,
      csv: csvPath,
    },
  };
};

export default { generateReportsForRun };
