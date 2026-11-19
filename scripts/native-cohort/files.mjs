// Canonical regular bytes and their digest, shared by normal identity observations.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function regular(file, limit = 64 * 1024 * 1024) {
  assert.equal(realpathSync(file), resolve(file));
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    assert(stat.isFile() && stat.nlink === 1 && stat.size <= limit);
    const bytes = readFileSync(fd), after = fstatSync(fd);
    assert(bytes.length <= limit && bytes.length === stat.size && after.size === stat.size
      && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs);
    return bytes;
  } finally { closeSync(fd); }
}
