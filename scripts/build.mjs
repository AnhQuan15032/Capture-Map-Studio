import { mkdir, copyFile } from 'node:fs/promises';

// Explicit allowlist: never publish repository metadata or development files.
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await copyFile(new URL('../index.html', import.meta.url), new URL('../dist/index.html', import.meta.url));
console.log('Built static site → dist/index.html');
