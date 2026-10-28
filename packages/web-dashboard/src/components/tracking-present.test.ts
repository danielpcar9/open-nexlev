import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAccumulatedViews, isJobActive, jobFromCancel, jobFromPoll, jobHeadline } from './tracking-present';

test('history value 12345 uses the locale and a real null stays absent', () => {
  assert.equal(formatAccumulatedViews(12345), (12345).toLocaleString());
  assert.notEqual(formatAccumulatedViews(null), '0');
  assert.equal(formatAccumulatedViews(null), '—');
});

test('cancelling a queued capture is already cancelled', () => {
  const job = jobFromCancel({ id: 'job-queued', status: 'cancelled', cancelRequested: true });
  assert.equal(job.status, 'cancelled');
  assert.equal(job.cancelRequested, false);
  assert.equal(isJobActive(job), false);
  assert.match(jobHeadline(job), /cancelled/);
  assert.doesNotMatch(jobHeadline(job), /cancelación solicitada/);
});

test('cancelling a running capture stays running until a later poll confirms it', () => {
  const requested = jobFromCancel({ id: 'job-running', status: 'running', cancelRequested: true });
  assert.equal(requested.status, 'running');
  assert.equal(requested.cancelRequested, true);
  assert.equal(isJobActive(requested), true);
  assert.match(jobHeadline(requested), /cancelación solicitada/);
  const stillRunning = jobFromPoll(requested, { id: 'job-running', status: 'running', error: null });
  assert.equal(stillRunning.cancelRequested, true);
  assert.equal(isJobActive(stillRunning), true);
  const confirmed = jobFromPoll(stillRunning, { id: 'job-running', status: 'cancelled', error: null });
  assert.equal(confirmed.status, 'cancelled');
  assert.equal(confirmed.cancelRequested, false);
  assert.equal(isJobActive(confirmed), false);
  assert.match(jobHeadline(confirmed), /\(cancelled\)/);
});
