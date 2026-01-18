import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev/prod safety net:
 * Some environments produce only hashed CSS files like:
 *   .next/static/css/<hash>.css
 * while the HTML references:
 *   /_next/static/css/app/layout.css
 * which becomes 404 (or NEXT_NOT_FOUND HTML) and can result in a blank/unstyled screen.
 *
 * This script creates `.next/static/css/app/layout.css` by copying the best candidate
 * from `.next/static/css/*.css` (largest file) if it is missing.
 */

const projectRoot = process.cwd();
const distDirName = process.env.NEXT_DIST_DIR || '.next';
const cssDir = path.join(projectRoot, distDirName, 'static', 'css');
const targetDir = path.join(cssDir, 'app');
const targetPath = path.join(targetDir, 'layout.css');

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function listCssFiles(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.css'))
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

function main() {
  if (exists(targetPath)) {
    console.log(`[ensure-next-css-aliases] ok ${path.relative(projectRoot, targetPath)} (already exists)`);
    process.exit(0);
  }

  const files = listCssFiles(cssDir);
  if (files.length === 0) {
    console.warn(`[ensure-next-css-aliases] no css files found under ${cssDir}`);
    process.exit(0);
  }

  // Pick the largest CSS file as the most likely global stylesheet (tailwind output).
  const withSize = files
    .map((p) => ({ p, size: fs.statSync(p).size }))
    .sort((a, b) => b.size - a.size);
  const src = withSize[0]?.p;
  if (!src) {
    console.warn(`[ensure-next-css-aliases] no css candidate found`);
    process.exit(0);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(src, targetPath);
  console.log(
    `[ensure-next-css-aliases] created ${path.relative(projectRoot, targetPath)} <- ${path.basename(src)} (${withSize[0].size} bytes)`
  );
  process.exit(0);
}

main();

