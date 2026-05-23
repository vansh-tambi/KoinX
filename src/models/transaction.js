import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const transactionSchema = new mongoose.Schema({
  _id: { 
    type: String, 
    default: uuidv4 
  },
  
  runId: {
    type: String,
    ref: 'ReconciliationRun',
    required: [true, 'Reconciliation run ID is required'],
    trim: true,
  },
  
  source: {
    type: String,
    required: [true, 'Source identifier is required'],
    uppercase: true,
    trim: true,
    enum: {
      values: ['USER', 'EXCHANGE'],
      message: '{VALUE} is not a supported transaction source',
    },
  },
  
  originalRow: {
    type: mongoose.Schema.Types.Mixed,
    required: [true, 'Original raw CSV row is required'],
    default: {},
  },
  
  normalized: {
    txId: {
      type: String,
      required: [
        function() { return this.ingestionStatus?.valid; },
        'Normalized transaction ID (txId) is required for valid records'
      ],
      trim: true,
    },
    timestamp: {
      type: Date,
      required: [
        function() { return this.ingestionStatus?.valid; },
        'Normalized timestamp is required for valid records'
      ],
    },
    type: {
      type: String,
      required: [
        function() { return this.ingestionStatus?.valid; },
        'Normalized transaction type is required for valid records'
      ],
      uppercase: true,
      trim: true,
      validate: {
        validator: function(value) {
          if (!value) return true; // Handled by required check
          if (this.ingestionStatus && !this.ingestionStatus.valid) return true; // Bypass for invalid rows
          return ['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT', 'CREDIT', 'DEBIT', 'REFUND', 'CHARGEBACK'].includes(value);
        },
        message: '{VALUE} is not a supported normalized type',
      },
    },
    asset: {
      type: String,
      required: [
        function() { return this.ingestionStatus?.valid; },
        'Normalized asset identifier is required for valid records'
      ],
      uppercase: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: [
        function() { return this.ingestionStatus?.valid; },
        'Normalized quantity is required for valid records'
      ],
      validate: {
        validator: function(value) {
          if (value === undefined || value === null) return true;
          if (this.ingestionStatus && !this.ingestionStatus.valid) return true; // Bypass for invalid rows
          return value >= 0;
        },
        message: 'Normalized quantity must be a non-negative number',
      },
    },
    fee: {
      type: Number,
      default: 0,
      validate: {
        validator: function(value) {
          if (value === undefined || value === null) return true;
          if (this.ingestionStatus && !this.ingestionStatus.valid) return true; // Bypass for invalid rows
          return value >= 0;
        },
        message: 'Normalized fee must be a non-negative number',
      },
    },
  },
  
  ingestionStatus: {
    valid: {
      type: Boolean,
      required: true,
      default: true,
    },
    issues: {
      type: [String],
      default: [],
    },
  },
  
  reconciliationStatus: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    default: 'UNRECONCILED',
    enum: {
      values: ['UNRECONCILED', 'RECONCILED', 'PARTIALLY_RECONCILED', 'FAILED'],
      message: '{VALUE} is not a supported reconciliation status',
    },
  },
}, { 
  timestamps: true,
});

// Indexes
// Create compound unique index applying ONLY to valid documents.
// This enforces uniqueness for valid records but allows saving duplicate invalid records for audits.
transactionSchema.index(
  { runId: 1, source: 1, 'normalized.txId': 1 }, 
  { 
    unique: true, 
    partialFilterExpression: { 'ingestionStatus.valid': true } 
  }
);

transactionSchema.index({ reconciliationStatus: 1 });
transactionSchema.index({ 'normalized.timestamp': -1 });
transactionSchema.index({ runId: 1 });

export default mongoose.model('Transaction', transactionSchema);
