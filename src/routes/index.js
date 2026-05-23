import { Router } from 'express';
import reconciliationRoutes from './reconciliationRoutes.js';

const router = Router();

router.use('/reconciliation', reconciliationRoutes);

export default router;
