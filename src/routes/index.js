import { Router } from 'express';
import transactionRoutes from './transactionRoutes.js';
import reconciliationRoutes from './reconciliationRoutes.js';

const router = Router();

router.use('/transactions', transactionRoutes);
router.use('/reconciliation', reconciliationRoutes);

export default router;
