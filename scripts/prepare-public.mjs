import { cp, mkdir, rm, access } from 'node:fs/promises';
await rm('.vercel/output', { recursive: true, force: true });
await rm('.public', { recursive: true, force: true });
await mkdir('.public', { recursive: true });
for (const file of ['index.html', 'sw.js', 'manifest.webmanifest', 'icons', 'assets']) {
  try { await access(file); } catch { continue; }
  await cp(file, `.public/${file}`, { recursive: true });
}
