import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('Cloudflare preview is explicitly enabled and shares production assets', () => {
  assert.deepEqual(config.previews, {});
  assert.equal(config.assets.directory, './dist');
  assert.equal(config.build.command, 'npm run build');
});

test('Wrangler commands rely on its automatic build without recursively invoking Wrangler', () => {
  assert.equal(pkg.scripts.preview, 'wrangler preview');
  assert.equal(pkg.scripts.deploy, 'wrangler deploy');
  assert.equal(pkg.scripts.build, 'node scripts/build.mjs');
});
