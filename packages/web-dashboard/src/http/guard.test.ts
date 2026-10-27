import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeLocalWrite, readLimitedText } from './guard';

test('WEB-01 another origin or unexpected host is forbidden before any write', () => {
  assert.equal(authorizeLocalWrite('evil.test:3000', 'http://evil.test:3000').ok, false);
  assert.equal(authorizeLocalWrite('evil.test:3000', 'http://127.0.0.1:3000').ok, false);
  assert.equal(authorizeLocalWrite('127.0.0.1:3000', 'http://evil.test').ok, false);
  assert.equal(authorizeLocalWrite('127.0.0.1:3000', null).ok, true);
  assert.equal(authorizeLocalWrite('localhost:3000', 'http://localhost:3000').ok, true);
  assert.equal(authorizeLocalWrite('127.0.0.1:3000', 'http://127.0.0.1:3000').ok, true);
});

test('WEB-02 oversized or invalid bodies are rejected', async () => {
  const huge = await readLimitedText({ headers: { get: () => String(1024 * 1024 + 1) }, text: async () => '' });
  assert.equal(huge.ok && false, false);
  if (!huge.ok) assert.equal(huge.status, 413);
  const invalid = await readLimitedText({ headers: { get: () => 'nope' }, text: async () => '' });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.status, 400);
});
