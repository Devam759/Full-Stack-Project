import mongoose from 'mongoose';

export async function connectDB(uri) {
  if (!uri) {
    throw new Error('connectDB requires a valid MongoDB connection URI');
  }
  await mongoose.connect(uri);
  return mongoose.connection;
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export function isDBHealthy() {
  return mongoose.connection.readyState === 1;
}

export default {
  connectDB,
  disconnectDB,
  isDBHealthy,
};
