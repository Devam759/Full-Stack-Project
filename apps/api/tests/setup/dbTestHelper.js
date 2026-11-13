import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet = null;

export const DEFAULT_DOCKER_MONGODB_URI =
  'mongodb://127.0.0.1:27018/borrowloop_test?replicaSet=rs0&directConnection=true';

/**
 * Initializes and connects to a MongoDB replica set for integration tests.
 * Uses local replica set if MONGODB_TEST_URI is set, otherwise spins up MongoMemoryReplSet.
 */
export async function setupTestDB() {
  const uriFromEnv = process.env.MONGODB_TEST_URI;

  if (uriFromEnv) {
    let targetUri = uriFromEnv;
    try {
      const url = new URL(uriFromEnv);
      const workerId = process.env.VITEST_POOL_ID || process.pid;
      const baseDb = url.pathname.replace(/^\//, '') || 'borrowloop_test';
      url.pathname = `/${baseDb}_${workerId}`;
      targetUri = url.toString();
    } catch {
      // Fallback to original
    }

    await mongoose.connect(targetUri);
    return { uri: targetUri, isMemory: false };
  }

  replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger',
    },
  });

  let uri = replSet.getUri();
  try {
    const url = new URL(uri);
    const workerId = process.env.VITEST_POOL_ID || process.pid;
    const rand = Math.random().toString(36).substring(2, 7);
    url.pathname = `/borrowloop_test_${workerId}_${rand}`;
    uri = url.toString();
  } catch {
    // Fallback to original
  }
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
    try {
      if (mongoose.connection.db) {
        await mongoose.connection.db.dropDatabase();
      }
    } catch {
      // Ignore cleanup error
    }
    await mongoose.disconnect();
  }
  if (replSet) {
    try {
      await replSet.stop({ force: true });
    } catch {
      // Ignore cleanup error
    }
    replSet = null;
  }
}

export default {
  setupTestDB,
  clearTestDB,
  teardownTestDB,
};
