import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const reconciliationRunSchema = new mongoose.Schema({
  _id: { 
    type: String, 
    default: uuidv4 
  },
  
  runId: {
    type: String,
    required: true,
    unique: true,
    default: uuidv4,
    trim: true,
  },
  
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  
  status: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    default: 'PENDING',
    enum: {
      values: ['PENDING', 'PROCESSING', 'MATCHING', 'REPORTING', 'COMPLETED', 'FAILED'],
      message: '{VALUE} is not a supported run status',
    },
  },
  
  summary: {
    type: mongoose.Schema.Types.Mixed,
    default: {
      totalCount: 0,
      reconciledCount: 0,
      unreconciledCount: 0,
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
}, { 
  timestamps: true,
});

// Indexes
reconciliationRunSchema.index({ runId: 1 }, { unique: true });
reconciliationRunSchema.index({ status: 1 });
reconciliationRunSchema.index({ startedAt: -1 });

export default mongoose.model('ReconciliationRun', reconciliationRunSchema);
