import transactionService from '../services/transactionService.js';

const getAll = async (req, res, next) => {
  try {
    const result = await transactionService.getAll();
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const result = await transactionService.create(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const result = await transactionService.getById(req.params.id);
    if (!result) {
      return res.status(404).json({
        success: false,
        error: { message: `Transaction not found with ID: ${req.params.id}` }
      });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const result = await transactionService.update(req.params.id, req.body);
    if (!result) {
      return res.status(404).json({
        success: false,
        error: { message: `Transaction not found with ID: ${req.params.id}` }
      });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    const result = await transactionService.remove(req.params.id);
    if (!result) {
      return res.status(404).json({
        success: false,
        error: { message: `Transaction not found with ID: ${req.params.id}` }
      });
    }
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
};

export default { getAll, create, getById, update, remove };
