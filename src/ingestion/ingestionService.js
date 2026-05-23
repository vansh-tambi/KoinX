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

  const processedTxIds = new Set();
  let totalRows = 0;
  let validRows = 0;
  let invalidRows = 0;
  const issuesLog = [];

  const fileStream = fs.createReadStream(filePath);

  const BATCH_SIZE = 500;
  let batch = [];
  let rowsInserted = 0;
  let rowsFailed = 0;

  const flushBatch = async () => {
    if (batch.length === 0) return;
    try {
      const result = await transactionRepository.insertMany(batch, { ordered: false });
      rowsInserted += result.length;
    } catch (err) {
      if (err.name === 'BulkWriteError' || err.code === 11000 || err.writeErrors) {
        const failedCount = err.writeErrors ? err.writeErrors.length : (batch.length - (err.result?.nInserted || 0));
        rowsFailed += failedCount;
        rowsInserted += (batch.length - failedCount);
      } else {
        rowsFailed += batch.length;
        throw err;
      }
    }
    batch = [];
  };

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

        // Add to batch
        batch.push({
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

        // Insert batch if size matches BATCH_SIZE
        if (batch.length >= BATCH_SIZE) {
          await flushBatch();
        }
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

    // Flush any remaining records in the batch
    await flushBatch();

    return {
      success: true,
      runId,
      source,
      totalRows,
      validRows,
      invalidRows,
      issues: issuesLog,
      rowsProcessed: totalRows,
      rowsInserted,
      rowsFailed,
    };

  } catch (err) {
    console.error(`[INGESTION ERROR] Ingestion aborted for file ${filePath}:`, err);
    throw err;
  }
};

export default { ingestCsvFile };
