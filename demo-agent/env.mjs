/**
 * Hand-rolled .env loader — no dependency (dress-shop pattern). The KEY is only
 * ever read into process.env and handed to the Anthropic provider; it is NEVER
 * printed or logged (see server.mjs boot banner, which only reports presence).
 *
 * Two documented locations are tried IN ORDER (first wins, never overwrites a
 * value already in the environment):
 *   1. vizfootprint/.env                       (this repo)
 *   2. ../hcifootprint-demo/dress-shop/.env     (the shared local key on this
 *                                                machine — the dress-shop demo's)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Candidate .env paths, in precedence order. */
const CANDIDATES = [
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '..', 'hcifootprint-demo', 'dress-shop', '.env'),
];

/** Parse one .env file into process.env (never overwrites an existing value). */
function loadFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false; // absent — try the next candidate
  }
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      // strip surrounding quotes if present
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  return true;
}

/** Load the first available .env. Returns the path used, or null. */
export function loadDotEnv() {
  for (const file of CANDIDATES) {
    if (loadFile(file)) return file;
  }
  return null;
}
