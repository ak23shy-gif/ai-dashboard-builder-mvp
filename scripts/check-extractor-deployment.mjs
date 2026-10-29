import { readFileSync } from 'node:fs';

// ignoreCommand uses inverted status codes: 0 skips, 1 builds.
const ignore = process.argv.includes('--ignore');
const host = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const allowed = host === 'google-api-data-extractor.vercel.app';
if (ignore) {
  console.log(allowed ? 'Build Extract in its own Vercel project.' : 'Skip: this source belongs only to the Extract Vercel project.');
  process.exit(allowed ? 1 : 0);
}
if (process.env.VERCEL === '1' && !allowed) {
  console.error('Deployment stopped: Extract must build in google-api-data-extractor.vercel.app. Check VERCEL_PROJECT_PRODUCTION_URL and automatic system environment variables.');
  process.exit(1);
}

// This repository contains legacy dashboard code. The Extract production
// project must never promote that application as its homepage.
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const validImport = /import\s*\{\s*ExtractionApp\s*\}\s*from\s*['"]@\/components\/extraction\/ExtractionApp['"]/.test(page);
const validHome = /return\s*\(?\s*<ExtractionApp\s*\/>\s*\)?\s*;/.test(page);
if (!validImport || !validHome) {
  console.error('Deployment stopped: the Extract homepage must render ExtractionApp. Deploy other software through its own repository and Vercel project.');
  process.exit(1);
}
console.log('Extract homepage deployment check passed.');
