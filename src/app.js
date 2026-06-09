import express from 'express';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cors from 'cors';
import Redis from 'ioredis';
import routes from './routes/index.js';
import { connectDb } from './config/database.js';
import redisConfig from './config/redis.js';
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
if (process.env.NODE_ENV !== 'test') {
  connectDb()
    .then(() => {
      // Start Express listener
      app.listen(PORT, () => {
        console.log(`[SERVER] Listening on port ${PORT}`);
      });

      // Start BullMQ background worker if Redis is available, otherwise use in-process fallback
      console.log('[JOBS] Checking Redis broker availability...');
      const redisClient = new Redis({
        host: redisConfig.host,
        port: redisConfig.port,
        connectTimeout: 1000,
        maxRetriesPerRequest: 0, // Fail fast immediately
      });

      // Register error handler to suppress unhandled error event logging
      redisClient.on('error', () => {});

      redisClient.ping()
        .then(() => {
          console.log('[JOBS] Redis broker is online. Starting background worker...');
          redisClient.disconnect();
          startReconciliationWorker();
        })
        .catch(() => {
          console.warn('[JOBS] Redis broker is offline. Falling back to in-process background task execution (no Redis required for demo!).');
          process.env.USE_IN_PROCESS_QUEUE = 'true';
          redisClient.disconnect();
        });
    })
    .catch((err) => {
      console.error('[FATAL] Failed to bootstrap database connection', err);
      process.exit(1);
    });
}

export default app;
