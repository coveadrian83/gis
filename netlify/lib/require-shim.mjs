// Modulele din server/ sunt CommonJS și folosesc require('node:…'). Când funcția este împachetată ca ESM,
// `require` nu există; îl punem la dispoziție înainte de încărcarea celorlalte module.
import { createRequire } from 'node:module';

if (typeof globalThis.require === 'undefined') globalThis.require = createRequire(import.meta.url);
