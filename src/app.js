import express from 'express';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cors from 'cors';
import routes from './routes/index.js';
import { connectDb } from './config/database.js';
import requestLogger from './middleware/requestLogger.js';
import errorHandler from './middleware/errorHandler.js';
import startReconciliationWorker from './jobs/reconciliationWorker.js';

// Load environment variables
dotenv.config();

const app = express();

// Global Middlewares
app.use(helmet());
app.use(cors());
app.use(requestLogger);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount Routing Tree
app.use('/api', routes);

// Centralized error handling
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

// Connect to DB and Start Listening
connectDb()
  .then(() => {
    // Start Express listener
    app.listen(PORT, () => {
      console.log(`[SERVER] Listening on port ${PORT}`);
    });

    // Start BullMQ background worker
    console.log('[JOBS] Starting reconciliation background worker...');
    startReconciliationWorker();
  })
  .catch((err) => {
    console.error('[FATAL] Failed to bootstrap database connection', err);
    process.exit(1);
  });

export default app;
