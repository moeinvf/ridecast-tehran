import { defineNitroConfig } from 'nitro/config';

export default defineNitroConfig({
  preset: 'vercel',
  modules: ['workflow/nitro'],
  vercel: { entryFormat: 'node' },
  publicAssets: [{ dir: './.public', maxAge: 0 }],
  routes: { '/**': { handler: './server/app.mjs', format: 'node' } },
});
