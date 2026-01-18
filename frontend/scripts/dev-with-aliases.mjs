import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Runs `next dev` and, once `.next/static` exists, runs our alias scripts:
 * - ensure-next-app-route-chunks.mjs
 * - ensure-next-css-aliases.mjs
 *
 * Reason: some environments generate only hashed assets; HTML references non-hashed paths.
 * If those paths 404, the browser can go blank (no hydration).
 */

const projectRoot = process.cwd();
const distDirName = process.env.NEXT_DIST_DIR || '.next';
const distDir = path.join(projectRoot, distDirName);
const nextStaticDir = path.join(distDir, 'static');

const ensureAppRoutesScript = path.join(projectRoot, 'scripts', 'ensure-next-app-route-chunks.mjs');
const ensureCssScript = path.join(projectRoot, 'scripts', 'ensure-next-css-aliases.mjs');

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

let ensureScheduled = false;
function scheduleEnsureAliases(reason = 'unknown') {
  if (ensureScheduled) return;
  ensureScheduled = true;
  // Debounce bursts of fs events.
  setTimeout(() => {
    ensureScheduled = false;
    if (!exists(nextStaticDir)) return;
    try {
      // eslint-disable-next-line no-console
      console.log(`[dev-with-aliases] ensure aliases (${distDirName}) reason=${reason}`);
      spawn(process.execPath, [ensureAppRoutesScript], { stdio: 'inherit', env: process.env });
      spawn(process.execPath, [ensureCssScript], { stdio: 'inherit', env: process.env });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[dev-with-aliases] WARN failed to run alias scripts:', e);
    }
  }, 50);
}

// Watch for `.next` creation/changes. Next dev touches many files, so this should fire quickly.
let watcher = null;
try {
  // Watch distDir for changes; Next writes files here during compilation.
  watcher = fs.watch(distDir, { persistent: true, recursive: true }, () => scheduleEnsureAliases('fswatch'));
} catch {
  // ignore
}

// Also try early (in case static already exists).
scheduleEnsureAliases('startup');

// Run `next dev` with passthrough args.
const nextBin = path.join(projectRoot, 'node_modules', '.bin', 'next');
const args = ['dev', ...process.argv.slice(2)];
const child = spawn(nextBin, args, { stdio: 'inherit' });

child.on('exit', (code) => {
  try {
    watcher?.close();
  } catch {
    // ignore
  }
  process.exit(code ?? 0);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));

