import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const discrepancySchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: [true, 'Discrepancy transaction reference ID is required'],
  },
  
  type: {
    type: String,
    required: [true, 'Discrepancy type is required'],
    uppercase: true,
    trim: true,
    enum: {
      values: ['AMOUNT_MISMATCH', 'DATE_MISMATCH', 'STATUS_MISMATCH', 'MISSING_IN_SOURCE', 'MISSING_IN_TARGET'],
      message: '{VALUE} is not a supported discrepancy type',
    },
  },
  
  severity: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    default: 'LOW',
    enum: {
      values: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      message: '{VALUE} is not a supported severity level',
    },
  },
  
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, { _id: false }); // Disable subdocument _id for discrepancies

const reconciliationReportSchema = new mongoose.Schema({
  _id: { 
    type: String, 
    default: uuidv4 
  },
  
  runId: {
    type: String,
    ref: 'ReconciliationRun',
    required: [true, 'Reconciliation run ID reference is required'],
  },
  
  name: {
    type: String,
    required: [true, 'Report name is required'],
    trim: true,
  },
  
  type: {
    type: String,
    required: [true, 'Report type is required'],
    uppercase: true,
    trim: true,
    default: 'AD_HOC',
    enum: {
      values: ['DAILY', 'WEEKLY', 'MONTHLY', 'AD_HOC'],
      message: '{VALUE} is not a supported report type',
    },
  },
  
  status: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    default: 'DRAFT',
    enum: {
      values: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
      message: '{VALUE} is not a supported report status',
    },
  },
  
  summary: {
    totalTransactions: { 
      type: Number, 
      default: 0, 
      min: [0, 'totalTransactions cannot be negative'] 
    },
    matchedTransactions: { 
      type: Number, 
      default: 0, 
      min: [0, 'matchedTransactions cannot be negative'] 
    },
    mismatchedTransactions: { 
      type: Number, 
      default: 0, 
      min: [0, 'mismatchedTransactions cannot be negative'] 
    },
    totalAmountReconciled: { 
      type: Number, 
      default: 0, 
      min: [0, 'totalAmountReconciled cannot be negative'] 
    },
    totalAmountMismatched: { 
      type: Number, 
      default: 0, 
      min: [0, 'totalAmountMismatched cannot be negative'] 
    },
    currency: { 
      type: String, 
      uppercase: true, 
      trim: true, 
      default: 'USD' 
    },
  },
  
  discrepancies: [discrepancySchema],
  
  generatedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  
  rawReportData: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, { 
  timestamps: true,
});

// Indexes
reconciliationReportSchema.index({ runId: 1 });
reconciliationReportSchema.index({ type: 1 });
reconciliationReportSchema.index({ status: 1 });
reconciliationReportSchema.index({ generatedAt: -1 });

export default mongoose.model('ReconciliationReport', reconciliationReportSchema);
