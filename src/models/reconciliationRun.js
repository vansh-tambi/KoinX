import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const reconciliationRunSchema = new mongoose.Schema({
  _id: { 
    type: String, 
    default: uuidv4 
  },
  
  runNumber: {
    type: String,
    required: [true, 'Run number is required'],
    unique: true,
    trim: true,
  },
  
  status: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    default: 'PENDING',
    enum: {
      values: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
      message: '{VALUE} is not a supported run status',
    },
  },
  
  startedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  
  completedAt: {
    type: Date,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return value >= this.startedAt;
      },
      message: 'completedAt ({VALUE}) must be after or equal to startedAt',
    },
  },
  
  totalCount: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'totalCount cannot be negative'],
  },
  
  reconciledCount: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'reconciledCount cannot be negative'],
  },
  
  unreconciledCount: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'unreconciledCount cannot be negative'],
  },
  
  reconciliationRules: {
    type: mongoose.Schema.Types.Mixed,
    default: [],
  },
  
  initiatedBy: {
    type: String,
    required: [true, 'Initiator ID or service is required'],
    trim: true,
  },
  
  errorMessage: {
    type: String,
    trim: true,
    default: null,
  },
  
  rawConfig: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, { 
  timestamps: true,
});

// Indexes
reconciliationRunSchema.index({ runNumber: 1 }, { unique: true });
reconciliationRunSchema.index({ status: 1 });
reconciliationRunSchema.index({ startedAt: -1 });

export default mongoose.model('ReconciliationRun', reconciliationRunSchema);
