import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet = null;

/**
 * Initializes and connects to a MongoDB replica set for integration tests.
 * Uses local replica set if MONGODB_TEST_URI is set, otherwise spins up MongoMemoryReplSet.
 */
export async function setupTestDB() {
  const uriFromEnv = process.env.MONGODB_TEST_URI;

  if (uriFromEnv) {
    await mongoose.connect(uriFromEnv);
    return { uri: uriFromEnv, isMemory: false };
  }

  replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger',
    },
  });

  const uri = replSet.getUri();
  await mongoose.connect(uri);

  return { uri, isMemory: true };
}

/**
 * Clears all collections in the test database.
 */
export async function clearTestDB() {
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
  }
}

/**
 * Disconnects and tears down the test replica set.
 */
export async function teardownTestDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}

export default {
  setupTestDB,
  clearTestDB,
  teardownTestDB,
};
