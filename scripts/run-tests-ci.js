import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resultsFile = '.test-results.json';

const vitestBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = [
  'vitest',
  'run',
  '--reporter=default',
  '--reporter=json',
  `--outputFile=${resultsFile}`,
];

console.info('Running test suite with skipped-test guard...');
const child = spawn(vitestBin, args, {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

child.on('close', (code) => {
  if (!fs.existsSync(resultsFile)) {
    console.error('Test results file was not generated.');
    process.exit(code || 1);
  }

  let results;
  try {
    results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  } catch (err) {
    console.error('Failed to parse test results JSON:', err.message);
    process.exit(1);
  } finally {
    try {
      fs.unlinkSync(resultsFile);
    } catch {
      // Ignore cleanup error
    }
  }

  // Count skipped / pending / todo tests
  let skippedCount = 0;
  const skippedList = [];

  const testResults = results.testResults || [];
  for (const suite of testResults) {
    for (const test of suite.assertionResults || []) {
      if (test.status === 'skipped' || test.status === 'pending' || test.status === 'todo') {
        skippedCount++;
        skippedList.push(`${suite.name} -> ${test.title} (${test.status})`);
      }
    }
  }

  if (skippedCount > 0) {
    console.error(`\n❌ CI GUARD FAILURE: Found ${skippedCount} skipped or todo test(s):`);
    for (const item of skippedList) {
      console.error(`  - ${item}`);
    }
    console.error(
      'All tests must be active and passing. Skipped tests are strictly forbidden in CI.\n',
    );
    process.exit(1);
  }

  if (code !== 0 || !results.success) {
    console.error(`\n❌ Tests failed with exit code ${code}`);
    process.exit(code || 1);
  }

  console.info(
    `\n✅ All tests passed with 0 skipped tests (${results.numPassedTests || 0} active tests verified).`,
  );
  process.exit(0);
});
