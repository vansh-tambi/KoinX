import { Router } from 'express';
import transactionController from '../controllers/transactionController.js';

const router = Router();

router.get('/', transactionController.getAll);
router.post('/', transactionController.create);
router.get('/:id', transactionController.getById);
router.put('/:id', transactionController.update);
router.delete('/:id', transactionController.remove);

export default router;
