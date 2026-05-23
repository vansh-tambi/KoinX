import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const reconciliationReportSchema = new mongoose.Schema({
  _id: { 
    type: String, 
    default: uuidv4 
  },
  
  runId: {
    type: String,
    ref: 'ReconciliationRun',
    required: [true, 'runId reference is required'],
    trim: true,
  },
  
  category: {
    type: String,
    required: [true, 'Report category is required'],
    lowercase: true,
    trim: true,
    enum: {
      values: ['matched', 'conflicting', 'unmatched_user', 'unmatched_exchange'],
      message: '{VALUE} is not a supported report category',
    },
  },
  
  confidence: {
    type: Number,
    required: true,
    min: [0, 'Confidence score cannot be less than 0'],
    max: [1, 'Confidence score cannot be more than 1'],
    default: 1.0,
  },
  
  userTx: {
    type: String,
    ref: 'Transaction',
    default: null,
  },
  
  exchangeTx: {
    type: String,
    ref: 'Transaction',
    default: null,
  },
  
  reason: {
    type: String,
    required: [true, 'Reason description is required'],
    trim: true,
  },
}, { 
  timestamps: true,
});

// Indexes
reconciliationReportSchema.index({ runId: 1 });
reconciliationReportSchema.index({ category: 1 });
reconciliationReportSchema.index({ runId: 1, category: 1 });

export default mongoose.model('ReconciliationReport', reconciliationReportSchema);
