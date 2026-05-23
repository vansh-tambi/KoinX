import fs from 'fs';
import path from 'path';
import { parseCsvStream } from './parser/csvParser.js';
import { validateTransactionRow } from './validators/transactionValidator.js';
import { normalizeTransactionRow } from './normalizers/transactionNormalizer.js';
import transactionRepository from '../repositories/transactionRepository.js';
import reconciliationRunRepository from '../repositories/reconciliationRunRepository.js';

/**
 * Reads, parses, normalizes, validates, and stores a CSV transaction file.
 * Handles duplicate checks, timezone adjustments, and updates the ReconciliationRun tracking record.
 * 
 * @param {string} filePath - Absolute or relative path to the CSV file.
 * @param {string} runId - The runId matching the ReconciliationRun.
 * @param {string} source - USER or EXCHANGE.
 * @returns {Promise<Object>} Ingestion execution summary statistics and warning logs.
 */
export const ingestCsvFile = async (filePath, runId, source) => {
  // 1. Verify file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`Ingestion file not found: ${filePath}`);
  }

  // 2. Fetch the corresponding ReconciliationRun
  const run = await reconciliationRunRepository.findByRunId(runId);
  if (!run) {
    throw new Error(`ReconciliationRun not found with runId: ${runId}`);
  }

  // Update status to PROCESSING
  run.status = 'PROCESSING';
  await run.save();

  const processedTxIds = new Set();
  let totalRows = 0;
  let validRows = 0;
  let invalidRows = 0;
  const issuesLog = [];

  const fileStream = fs.createReadStream(filePath);

  try {
    await parseCsvStream(
      fileStream,
      {},
      async (row) => {
        totalRows++;

        // Perform validation (duplicate checks compare against local processed list)
        const { valid, issues } = validateTransactionRow(row, processedTxIds);

        // Add to processed set to catch duplicates later in the same run/source
        if (row.transaction_id && String(row.transaction_id).trim() !== '') {
          processedTxIds.add(String(row.transaction_id).trim());
        }

        // Normalize fields
        const normalized = normalizeTransactionRow(row);

        if (valid) {
          validRows++;
        } else {
          invalidRows++;
          issuesLog.push({
            rowNumber: totalRows,
            txId: normalized.txId || 'UNKNOWN',
            issues,
          });
        }

        // Save transaction record to the database (valid: false are still saved)
        await transactionRepository.create({
          runId,
          source: source.toUpperCase(),
          originalRow: row,
          normalized,
          ingestionStatus: {
            valid,
            issues,
          },
          reconciliationStatus: 'UNRECONCILED',
        });
      },
      (warning, row) => {
        // If parser encounters row-level structural warnings
        invalidRows++;
        issuesLog.push({
          rowNumber: totalRows,
          txId: row?.transaction_id || 'UNKNOWN',
          issues: [warning],
        });
      }
    );

    // Update reconciliation run metrics
    const existingSummary = run.summary || {};
    const updatedSummary = {
      totalCount: (existingSummary.totalCount || 0) + totalRows,
      reconciledCount: existingSummary.reconciledCount || 0,
      unreconciledCount: (existingSummary.unreconciledCount || 0) + validRows,
      invalidCount: (existingSummary.invalidCount || 0) + invalidRows,
    };

    await reconciliationRunRepository.completeRun(run._id, updatedSummary, 'COMPLETED');

    return {
      success: true,
      runId,
      source,
      totalRows,
      validRows,
      invalidRows,
      issues: issuesLog,
    };

  } catch (err) {
    console.error(`[INGESTION ERROR] Ingestion aborted for file ${filePath}:`, err);
    // Mark run as failed
    run.status = 'FAILED';
    run.completedAt = new Date();
    await run.save();
    throw err;
  }
};

export default { ingestCsvFile };
