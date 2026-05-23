import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const transactionSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  // TODO: define transaction fields
}, { timestamps: true });

export default mongoose.model('Transaction', transactionSchema);
