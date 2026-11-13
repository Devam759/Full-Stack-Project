/**
 * @file scripts/execute-clean-rerun.js
 * Executes a clean re-run verification from an isolated directory:
 * 1. Checks Docker compose up -d
 * 2. Copies monorepo to clean temp folder without node_modules and dist
 * 3. Runs npm ci
 * 4. Runs npm run lint
 * 5. Runs npm run format:check
 * 6. Runs npm run build
 * 7. Runs npm test 3x (in-memory) and 1x (Docker Mongo)
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const sourceRoot = path.resolve('.');
const targetDir = path.join(os.tmpdir(), 'borrowloop_clean_rerun');

console.info('=== CLEAN RE-RUN AUDIT INITIATED ===');
console.info('Source:', sourceRoot);
console.info('Target:', targetDir);

// 1. Docker check
console.info('\n[1/7] Ensuring Docker containers are active...');
try {
  execSync('docker compose up -d', { stdio: 'inherit' });
} catch (e) {
  console.warn('Docker compose up warning:', e.message);
}

// 2. Prepare clean directory
console.info('\n[2/7] Preparing clean directory without node_modules and dist...');
try {
  const tmp = os.tmpdir();
  for (const f of fs.readdirSync(tmp)) {
    if (f.startsWith('mongo-mem-')) {
      fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
    }
  }
} catch {
  /* ignore */
}
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    const base = path.basename(src);
    if (base === 'node_modules' || base === 'dist' || base === '.git' || base === 'brain') {
      return;
    }
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

copyRecursive(sourceRoot, targetDir);
console.info('✓ Clean copy created successfully at:', targetDir);

// Helpers to run in clean dir
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runInTarget(command, args, env = {}) {
  console.info(`\n> ${command} ${args.join(' ')}`);
  const res = spawnSync(command, args, {
    cwd: targetDir,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: true,
  });
  if (res.status !== 0) {
    throw new Error(`Command failed with status ${res.status}: ${command} ${args.join(' ')}`);
  }
}

// 3. npm ci
console.info('\n[3/7] Running npm ci from clean directory...');
runInTarget(npmCmd, ['ci']);

// 4. npm run lint
console.info('\n[4/7] Running npm run lint...');
runInTarget(npmCmd, ['run', 'lint']);

// 5. npm run format:check
console.info('\n[5/7] Running npm run format:check...');
runInTarget(npmCmd, ['run', 'format:check']);

// 6. npm run build
console.info('\n[6/7] Running npm run build...');
runInTarget(npmCmd, ['run', 'build']);

// 7. Test runs: 3x in-memory, 1x Docker
console.info('\n[7/7] Running Test Matrix (3x in-memory, 1x Docker Mongo)...');
const testRuns = [
  { name: 'Run 1 (In-Memory)', env: { NODE_ENV: 'test' } },
  { name: 'Run 2 (In-Memory)', env: { NODE_ENV: 'test' } },
  { name: 'Run 3 (In-Memory)', env: { NODE_ENV: 'test' } },
  {
    name: 'Run 4 (Docker Mongo)',
    env: {
      NODE_ENV: 'test',
      MONGODB_TEST_URI:
        'mongodb://127.0.0.1:27018/borrowloop_test?replicaSet=rs0&directConnection=true',
    },
  },
];

const results = [];
for (const [idx, t] of testRuns.entries()) {
  console.info(`\n--- Starting Test ${t.name} [${idx + 1}/4] ---`);
  const startTime = Date.now();
  runInTarget(npmCmd, ['test'], t.env);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  results.push({
    Run: t.name,
    Status: 'PASS',
    Duration: `${duration}s`,
  });

  // Cleanup mongo-mem temp folders between runs to conserve disk space
  try {
    const tmp = os.tmpdir();
    for (const f of fs.readdirSync(tmp)) {
      if (f.startsWith('mongo-mem-')) {
        fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
      }
    }
  } catch {
    /* ignore */
  }
}

console.info('\n=== CLEAN RE-RUN AUDIT SUMMARY ===');
console.info(JSON.stringify(results, null, 2));

// Cleanup clean directory
try {
  fs.rmSync(targetDir, { recursive: true, force: true });
} catch {
  // Ignore temp cleanup error
}

console.info('\n✓ Clean re-run verification finished with 100% SUCCESS.');
