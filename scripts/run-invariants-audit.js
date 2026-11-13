import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { seedActiveWorkload } from './seed-active-invariants-workload.js';
import { verifyLiveInvariants } from './check-invariants.js';

async function main() {
  console.info('=== Setting up MongoDB Replica Set for Live Invariants Verification ===');
  let replSet = null;
  let uri = process.env.MONGODB_URI;

  if (!uri) {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    uri = replSet.getUri();
  }

  try {
    console.info('\n1. Seeding real active workload leaving active rows behind...');
    await seedActiveWorkload(uri);

    console.info('\n2. Executing 13-category invariants verification against active data...');
    const allPassed = await verifyLiveInvariants(uri);

    if (!allPassed) {
      console.error('Invariants check FAILED!');
      process.exit(1);
    }
    console.info('\nSUCCESS: All invariants verified with active non-zero rows present!');
  } finally {
    if (replSet) {
      await replSet.stop();
    }
  }
}

main().catch((err) => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
