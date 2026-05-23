import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null, // Essential setting for BullMQ to manage connection errors
};

/**
 * Returns a new ioredis instance based on config.
 * @returns {Redis}
 */
export const getRedisConnection = () => {
  return new Redis(redisConfig);
};

export default redisConfig;
