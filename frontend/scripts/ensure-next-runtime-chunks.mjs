import fs from 'node:fs';
import path from 'node:path';

/**
 * ChronologyAI fix:
 * In some environments, Next serves pages that reference these runtime chunks:
 *  - /_next/static/chunks/main-app.js
 *  - /_next/static/chunks/polyfills.js
 *  - /_next/static/chunks/app-pages-internals.js
 *
 * but the build output may only contain hashed equivalents (e.g. main-app-<hash>.js),
 * causing 404s and breaking hydration (=> buttons don't work).
 *
 * This script ensures the non-hashed runtime chunk filenames exist by copying from
 * the best matching hashed files in `.next/static/chunks`.
 */

const projectRoot = process.cwd();
const distDirName = process.env.NEXT_DIST_DIR || '.next';
const chunksDir = path.join(projectRoot, distDirName, 'static', 'chunks');

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function listJsFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.js'))
    .map((d) => path.join(dir, d.name));
}

function copyIfMissing({ targetName, pickSource }) {
  const targetPath = path.join(chunksDir, targetName);
  if (exists(targetPath)) {
    return { targetName, didCopy: false, reason: 'already-exists' };
  }

  const files = listJsFiles(chunksDir);
  const srcPath = pickSource(files);
  if (!srcPath) {
    return { targetName, didCopy: false, reason: 'source-not-found' };
  }

  fs.copyFileSync(srcPath, targetPath);
  return { targetName, didCopy: true, reason: path.basename(srcPath) };
}

function pickMainApp(files) {
  // Prefer the hashed main-app chunk if present.
  const match = files.find((p) => /[/\\]main-app-[a-f0-9]+\.js$/i.test(p));
  return match ?? null;
}

function pickPolyfills(files) {
  const match = files.find((p) => /[/\\]polyfills-[a-f0-9]+\.js$/i.test(p));
  return match ?? null;
}

function pickAppPagesInternals(files) {
  // There isn't always a dedicated `app-pages-internals-*.js` file.
  // In those cases, the internals live in a "main-*.js" chunk; pick the one that contains the marker string.
  const mainCandidates = files.filter((p) => /[/\\]main-[a-f0-9]+\.js$/i.test(p));
  for (const p of mainCandidates) {
    try {
      const buf = fs.readFileSync(p);
      // Fast-ish check; the file can be large.
      if (buf.includes(Buffer.from('app-pages-internals'))) {
        return p;
      }
    } catch {
      // ignore and continue
    }
  }
  return null;
}

function main() {
  if (!exists(chunksDir)) {
    console.warn(`[ensure-next-runtime-chunks] chunks dir not found: ${chunksDir}`);
    process.exit(0);
  }

  const results = [
    copyIfMissing({ targetName: 'main-app.js', pickSource: pickMainApp }),
    copyIfMissing({ targetName: 'polyfills.js', pickSource: pickPolyfills }),
    copyIfMissing({ targetName: 'app-pages-internals.js', pickSource: pickAppPagesInternals }),
  ];

  const copied = results.filter((r) => r.didCopy);
  const missing = results.filter((r) => r.reason === 'source-not-found');

  for (const r of results) {
    if (r.didCopy) {
      console.log(`[ensure-next-runtime-chunks] created ${r.targetName} <- ${r.reason}`);
    } else if (r.reason === 'already-exists') {
      console.log(`[ensure-next-runtime-chunks] ok ${r.targetName} (already exists)`);
    } else {
      console.warn(`[ensure-next-runtime-chunks] WARN ${r.targetName} (${r.reason})`);
    }
  }

  if (missing.length > 0) {
    // Do not fail the build; warn loudly so we can investigate.
    console.warn(
      `[ensure-next-runtime-chunks] Some runtime chunks could not be created (source missing): ${missing
        .map((m) => m.targetName)
        .join(', ')}`
    );
  }

  // Return success always.
  process.exit(0);
}

main();

