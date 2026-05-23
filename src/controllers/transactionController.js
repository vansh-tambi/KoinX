import transactionService from '../services/transactionService.js';

const getAll = async (req, res) => {
  const result = await transactionService.getAll();
  res.json(result);
};

const create = async (req, res) => {
  const result = await transactionService.create(req.body);
  res.status(201).json(result);
};

const getById = async (req, res) => {
  const result = await transactionService.getById(req.params.id);
  res.json(result);
};

const update = async (req, res) => {
  const result = await transactionService.update(req.params.id, req.body);
  res.json(result);
};

const remove = async (req, res) => {
  await transactionService.remove(req.params.id);
  res.sendStatus(204);
};

export default { getAll, create, getById, update, remove };
