// Zero-dependency static build for Cloudflare (Workers Static Assets or Pages).
// Copies everything in ./public into ./dist and stamps the build time.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, 'public');
const out = resolve(root, 'dist');

if (!existsSync(resolve(src, 'index.html'))) {
  console.error('✖ public/index.html not found');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });

const indexPath = resolve(out, 'index.html');
const stamp = new Date().toISOString();
const sha = (process.env.CF_PAGES_COMMIT_SHA || process.env.WORKERS_CI_COMMIT_SHA || '').slice(0, 7);
const html = readFileSync(indexPath, 'utf8').replace(
  '<head>',
  `<head>\n  <meta name="build" content="${stamp}${sha ? ' ' + sha : ''}" />`
);
writeFileSync(indexPath, html);

console.log(`✔ Built dist/ (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB index.html) at ${stamp}`);
