import mongoose from 'mongoose';
import config from './config/index.js';
import logger from './common/logger.js';

export async function connectDB(uri = config.MONGODB_URI) {
  try {
    await mongoose.connect(uri);
    logger.info({ uri: uri.replace(/\/\/.*@/, '//<redacted>@') }, 'Connected to MongoDB');
    return mongoose.connection;
  } catch (error) {
    logger.error({ err: error }, 'MongoDB connection error');
    throw error;
  }
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  }
}

export function isDBHealthy() {
  // readyState 1 means connected
  return mongoose.connection.readyState === 1;
}

export default {
  connectDB,
  disconnectDB,
  isDBHealthy,
};
