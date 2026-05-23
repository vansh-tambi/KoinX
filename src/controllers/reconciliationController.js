import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import reconciliationRunRepository from '../repositories/reconciliationRunRepository.js';
import reconciliationReportRepository from '../repositories/reconciliationReportRepository.js';
import { queueReconciliationJob } from '../jobs/reconciliationQueue.js';
import { formatReportToFlatList } from '../reporting/reportGenerator.js';

// Zod Schema to validate reconcile request payload
const reconcileRequestSchema = z.object({
  userFile: z.string({
    required_error: 'userFile path is required',
  }).min(1, 'userFile path cannot be empty'),
  
  exchangeFile: z.string({
    required_error: 'exchangeFile path is required',
  }).min(1, 'exchangeFile path cannot be empty'),
  
  config: z.object({
    timestampTolerance: z.number().int().positive('timestampTolerance must be a positive integer').optional(),
    quantityTolerance: z.number().positive('quantityTolerance must be a positive percentage value').optional(),
  }).optional(),
});

/**
 * Validates request payload and triggers an asynchronous reconciliation matching run.
 * Enqueues ingestion and matching tasks to BullMQ and responds immediately.
 * 
 * POST /reconcile
 */
export const triggerReconciliation = async (req, res, next) => {
  try {
    // 1. Validate request payload using Zod
    const validation = reconcileRequestSchema.safeParse(req.body);
    if (!validation.success) {
      const errorMessages = validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return res.status(400).json({
        success: false,
        error: { message: `Validation failed: ${errorMessages}` }
      });
    }

    const { userFile, exchangeFile, config } = validation.data;
    const runId = uuidv4();

    // 2. Create ReconciliationRun record in the database
    const run = await reconciliationRunRepository.create({
      runId,
      status: 'PENDING',
      config: config || {},
      startedAt: new Date(),
      summary: {
        totalTransactions: 0,
        matchedCount: 0,
        conflictingCount: 0,
        unmatchedUserCount: 0,
        unmatchedExchangeCount: 0
      }
    });

    // 3. Enqueue the task to BullMQ (runs Ingest User + Ingest Exchange + Match + Report)
    await queueReconciliationJob(run.runId, userFile, exchangeFile);

    // 4. Return standard async queued response
    res.status(202).json({
      runId: run.runId,
      status: 'queued',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Retrieves all flat reports generated for a run.
 * 
 * GET /report/:runId
 */
export const getReconciliationReport = async (req, res, next) => {
  try {
    const { runId } = req.params;
    
    // Check if the run exists
    const run = await reconciliationRunRepository.findByRunId(runId);
    if (!run) {
      return res.status(404).json({
        success: false,
        error: { message: `ReconciliationRun not found with runId: ${runId}` }
      });
    }

    // Retrieve report documents populating relations
    const reports = await reconciliationReportRepository.findAll(
      { runId },
      { populate: ['userTx', 'exchangeTx'] }
    );

    // Flatten to specified columns
    const flatReports = formatReportToFlatList(reports);

    res.status(200).json({
      success: true,
      reports: flatReports,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Retrieves execution summary statistics for a run.
 * 
 * GET /report/:runId/summary
 */
export const getReconciliationSummary = async (req, res, next) => {
  try {
    const { runId } = req.params;

    const run = await reconciliationRunRepository.findByRunId(runId);
    if (!run) {
      return res.status(404).json({
        success: false,
        error: { message: `ReconciliationRun not found with runId: ${runId}` }
      });
    }

    res.status(200).json({
      success: true,
      status: run.status,
      summary: run.summary || {},
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Retrieves unmatched report records.
 * 
 * GET /report/:runId/unmatched
 */
export const getUnmatchedReports = async (req, res, next) => {
  try {
    const { runId } = req.params;

    // Check if run exists
    const run = await reconciliationRunRepository.findByRunId(runId);
    if (!run) {
      return res.status(404).json({
        success: false,
        error: { message: `ReconciliationRun not found with runId: ${runId}` }
      });
    }

    // Find only unmatched categories
    const reports = await reconciliationReportRepository.findAll(
      {
        runId,
        category: { $in: ['unmatched_user', 'unmatched_exchange'] }
      },
      { populate: ['userTx', 'exchangeTx'] }
    );

    // Flatten representation
    const flatUnmatched = formatReportToFlatList(reports);

    res.status(200).json({
      success: true,
      unmatched: flatUnmatched,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Triggers file download of the exported CSV report from the reports/ directory.
 * 
 * GET /report/:runId/export
 */
export const exportReportCsv = async (req, res, next) => {
  try {
    const { runId } = req.params;

    // Build path to the generated CSV file
    const reportsDir = path.resolve('reports');
    const csvPath = path.join(reportsDir, `report_${runId}.csv`);

    // Verify if the file exists on disk
    if (!fs.existsSync(csvPath)) {
      return res.status(404).json({
        success: false,
        error: { message: `Export CSV report file not found for runId: ${runId}. Make sure the job completed successfully.` }
      });
    }

    // Trigger download response with appropriate headers
    res.download(csvPath, `reconciliation_report_${runId}.csv`);
  } catch (err) {
    next(err);
  }
};

export default {
  triggerReconciliation,
  getReconciliationReport,
  getReconciliationSummary,
  getUnmatchedReports,
  exportReportCsv
};
