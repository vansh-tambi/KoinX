import reconciliationRunRepository from '../repositories/reconciliationRunRepository.js';
import reconciliationReportRepository from '../repositories/reconciliationReportRepository.js';
import { queueReconciliationJob } from '../jobs/reconciliationQueue.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Trigger reconciliation run for processing.
 */
export const triggerReconciliation = async (req, res, next) => {
  try {
    const runNumber = `RUN-${Date.now()}`;
    
    // Create new reconciliation run tracking record
    const run = await reconciliationRunRepository.create({
      runNumber,
      status: 'PENDING',
      initiatedBy: req.body.initiatedBy || 'API',
      startedAt: new Date(),
      rawConfig: req.body.config || {},
    });

    // Add reconciliation processing job to BullMQ
    await queueReconciliationJob(run._id);

    res.status(202).json({
      success: true,
      message: 'Reconciliation run triggered and queued successfully.',
      data: {
        runId: run._id,
        runNumber: run.runNumber,
        status: run.status,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Retrieve a reconciliation report.
 */
export const getReconciliationReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const report = await reconciliationReportRepository.findById(reportId);
    
    if (!report) {
      return res.status(404).json({
        success: false,
        error: { message: `Reconciliation report not found with ID: ${reportId}` }
      });
    }

    res.json({
      success: true,
      data: report,
    });
  } catch (err) {
    next(err);
  }
};

export default { triggerReconciliation, getReconciliationReport };
