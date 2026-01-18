import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev/prod safety net:
 * Some Next outputs contain only hashed app route chunks like:
 *   .next/static/chunks/app/page-<hash>.js
 * while the HTML references:
 *   /_next/static/chunks/app/page.js
 * which becomes 404 => blank screen (no hydration).
 *
 * This script creates non-hashed aliases (page.js/layout.js) by copying the best
 * matching hashed chunk in each directory under `.next/static/chunks/app`.
 */

const projectRoot = process.cwd();
const distDirName = process.env.NEXT_DIST_DIR || '.next';
const appChunksDir = path.join(projectRoot, distDirName, 'static', 'chunks', 'app');

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureAliasInDir(dir, baseName) {
  const target = path.join(dir, `${baseName}.js`);
  if (exists(target)) return { target, didCopy: false, reason: 'already-exists' };

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const candidates = entries
    .filter((d) => d.isFile() && d.name.startsWith(`${baseName}-`) && d.name.endsWith('.js'))
    .map((d) => d.name)
    .sort();

  const srcName = candidates[0];
  if (!srcName) return { target, didCopy: false, reason: 'source-not-found' };

  const src = path.join(dir, srcName);
  fs.copyFileSync(src, target);
  return { target, didCopy: true, reason: srcName };
}

function walkDirs(dir) {
  const out = [dir];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) out.push(...walkDirs(path.join(dir, e.name)));
  }
  return out;
}

function main() {
  if (!exists(appChunksDir)) {
    console.warn(`[ensure-next-app-route-chunks] app chunks dir not found: ${appChunksDir}`);
    process.exit(0);
  }

  const dirs = walkDirs(appChunksDir);
  const results = [];
  for (const dir of dirs) {
    results.push(ensureAliasInDir(dir, 'page'));
    results.push(ensureAliasInDir(dir, 'layout'));
  }

  const copied = results.filter((r) => r.didCopy);
  for (const r of copied) {
    console.log(`[ensure-next-app-route-chunks] created ${path.relative(projectRoot, r.target)} <- ${r.reason}`);
  }

  process.exit(0);
}

main();

