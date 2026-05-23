import transactionRepository from '../repositories/transactionRepository.js';

const getAll = async () => {
  return transactionRepository.findAll();
};

const create = async (payload) => {
  return transactionRepository.create(payload);
};

const getById = async (id) => {
  return transactionRepository.findById(id);
};

const update = async (id, payload) => {
  return transactionRepository.update(id, payload);
};

const remove = async (id) => {
  return transactionRepository.delete(id);
};

export default { getAll, create, getById, update, remove };
