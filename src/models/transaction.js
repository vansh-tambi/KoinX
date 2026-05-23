import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const transactionSchema = new mongoose.Schema({
  _id: { 
    type: String, 
    default: uuidv4 
  },
  
  externalId: {
    type: String,
    required: [true, 'External transaction ID is required'],
    trim: true,
  },
  
  provider: {
    type: String,
    required: [true, 'Provider name is required'],
    uppercase: true,
    trim: true,
    enum: {
      values: ['STRIPE', 'PAYPAL', 'RAZORPAY', 'INTERNAL', 'UNKNOWN'],
      message: '{VALUE} is not a supported provider',
    },
  },
  
  type: {
    type: String,
    required: [true, 'Transaction type is required'],
    uppercase: true,
    trim: true,
    enum: {
      values: ['CREDIT', 'DEBIT', 'REFUND', 'CHARGEBACK'],
      message: '{VALUE} is not a supported transaction type',
    },
  },
  
  status: {
    type: String,
    required: [true, 'Transaction status is required'],
    uppercase: true,
    trim: true,
    enum: {
      values: ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED'],
      message: '{VALUE} is not a supported status',
    },
  },
  
  reconciliationStatus: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    default: 'UNRECONCILED',
    enum: {
      values: ['UNRECONCILED', 'RECONCILED', 'PARTIALLY_RECONCILED'],
      message: '{VALUE} is not a supported reconciliation status',
    },
  },
  
  reconciliationRunId: {
    type: String,
    ref: 'ReconciliationRun',
    default: null,
  },
  
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0, 'Amount must be a positive number'],
  },
  
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    uppercase: true,
    trim: true,
    minlength: [3, 'Currency must be a 3-letter ISO code'],
    maxlength: [3, 'Currency must be a 3-letter ISO code'],
  },
  
  normalizedAmount: {
    type: Number,
    required: [true, 'Normalized amount is required'],
    min: [0, 'Normalized amount must be a positive number'],
  },
  
  normalizedCurrency: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    default: 'USD',
  },
  
  transactionDate: {
    type: Date,
    required: [true, 'Transaction date is required'],
  },
  
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {},
  },
  
  raw: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, { 
  timestamps: true,
});

// Indexes
// Unique compound index for provider + externalId to prevent duplicate transactions
transactionSchema.index({ provider: 1, externalId: 1 }, { unique: true });
transactionSchema.index({ status: 1 });
transactionSchema.index({ reconciliationStatus: 1 });
transactionSchema.index({ transactionDate: -1 });
transactionSchema.index({ reconciliationRunId: 1 });

export default mongoose.model('Transaction', transactionSchema);
