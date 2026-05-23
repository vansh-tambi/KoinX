import { Router } from 'express';
import transactionRoutes from './transactionRoutes.js';

const router = Router();
router.use('/transactions', transactionRoutes);

export default router;
