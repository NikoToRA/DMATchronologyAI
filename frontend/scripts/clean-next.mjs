import fs from 'node:fs';
import path from 'node:path';

/**
 * Clean `.next` to avoid dev/build artifact mismatches.
 * This repo frequently switches between `next dev`, `next build`, and standalone output,
 * and stale artifacts can cause runtime errors like:
 *   Error: Cannot find module './72.js' (expected under .next/server/)
 */
const projectRoot = process.cwd();
const nextDir = path.join(projectRoot, '.next');

try {
  if (fs.existsSync(nextDir)) {
    fs.rmSync(nextDir, { recursive: true, force: true });
    // eslint-disable-next-line no-console
    console.log(`[clean-next] removed ${nextDir}`);
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn(`[clean-next] WARN failed to remove ${nextDir}:`, e);
}

