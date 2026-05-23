import Transaction from '../models/transaction.js';

const findAll = async () => {
  return Transaction.find();
};

const findById = async (id) => {
  return Transaction.findById(id);
};

const create = async (data) => {
  const doc = new Transaction(data);
  return doc.save();
};

const update = async (id, data) => {
  return Transaction.findByIdAndUpdate(id, data, { new: true });
};

const deleteDoc = async (id) => {
  return Transaction.findByIdAndDelete(id);
};

export default { findAll, findById, create, update, delete: deleteDoc };
