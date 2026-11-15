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
  }

  // Count skipped and failed tests
  let skippedCount = 0;
  const skippedList = [];
  const failedList = [];

  const testResults = results.testResults || [];
  for (const suite of testResults) {
    for (const test of suite.assertionResults || []) {
      if (test.status === 'skipped' || test.status === 'pending' || test.status === 'todo') {
        skippedCount++;
        skippedList.push(`${suite.name} -> ${test.title} (${test.status})`);
      }
      if (test.status === 'failed') {
        failedList.push({
          suite: suite.name,
          title: test.title,
          messages: test.failureMessages || [],
        });
      }
    }
  }

  // Write to GitHub Step Summary if in GitHub Actions
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      let md = `### CI Test Run Summary\n\n`;
      md += `- **Passed**: ${results.numPassedTests || 0}\n`;
      md += `- **Failed**: ${results.numFailedTests || failedList.length}\n`;
      md += `- **Skipped**: ${skippedCount}\n\n`;

      if (failedList.length > 0) {
        md += `#### ❌ Failed Tests (${failedList.length})\n\n`;
        for (const item of failedList) {
          md += `* **${item.suite}** > ${item.title}\n`;
          if (item.messages.length > 0) {
            md += `\`\`\`text\n${item.messages.join('\n')}\n\`\`\`\n`;
          }
        }
      }
      if (skippedList.length > 0) {
        md += `#### ⚠️ Skipped Tests (${skippedCount})\n\n`;
        for (const item of skippedList) {
          md += `* ${item}\n`;
        }
      }
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    } catch {
      // Ignore step summary write error
    }
  }

  if (failedList.length > 0) {
    console.error(`\n❌ CI FAILURE: Found ${failedList.length} failed test(s):`);
    for (const item of failedList) {
      console.error(`  - ${item.suite} > ${item.title}`);
      for (const msg of item.messages) {
        console.error(`    ${msg.split('\n')[0]}`);
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

  if (code !== 0 || !results.success || failedList.length > 0) {
    console.error(`\n❌ Tests failed with exit code ${code}`);
    process.exit(code || 1);
  }

  try {
    fs.unlinkSync(resultsFile);
  } catch {
    // Ignore cleanup error
  }

  console.info(
    `\n✅ All tests passed with 0 skipped tests (${results.numPassedTests || 0} active tests verified).`,
  );
  process.exit(0);
});
