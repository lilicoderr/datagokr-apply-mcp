import fs from 'node:fs';
import { buildErrorCatalog } from '../src/errorcatalog.js';

const out = new URL('../docs/error-catalog.md', import.meta.url);
fs.writeFileSync(out, buildErrorCatalog(), 'utf8');
console.log('wrote docs/error-catalog.md');
