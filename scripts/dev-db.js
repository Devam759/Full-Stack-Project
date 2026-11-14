/**
 * @file scripts/dev-db.js
 * Lightweight standalone development MongoDB Replica Set runner.
 * Spins up a local MongoDB 7.0 replica set on port 27018 with name 'rs0'
 * without requiring Docker or manual mongod configuration.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';

async function startDevReplicaSet() {
  console.info('=== Starting Local Development MongoDB Replica Set ===');
  console.info(
    'Binding to: mongodb://127.0.0.1:27018/borrowloop?replicaSet=rs0&directConnection=true',
  );

  try {
    const replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        {
          port: 27018,
          storageEngine: 'wiredTiger',
        },
      ],
      replSet: {
        name: 'rs0',
        count: 1,
        storageEngine: 'wiredTiger',
      },
    });

    console.info('\n SUCCESS: Local MongoDB Replica Set is ACTIVE and listening on port 27018!');
    console.info('URI: mongodb://127.0.0.1:27018/borrowloop?replicaSet=rs0&directConnection=true');
    console.info('\nYou can now run in a separate terminal:');
    console.info('  npm run dev:api');
    console.info('  npm run dev:web');
    console.info('\nPress Ctrl+C to stop the replica set.\n');

    const handleExit = async () => {
      console.info('\nStopping MongoDB replica set...');
      await replSet.stop();
      console.info('Stopped.');
      process.exit(0);
    };

    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);
  } catch (err) {
    if (err.message && err.message.includes('EADDRINUSE')) {
      console.error(
        '\nPort 27018 is already in use by another process (e.g. Docker container or another instance).',
      );
    } else {
      console.error('\nFailed to start replica set:', err);
    }
    process.exit(1);
  }
}

startDevReplicaSet();
