import type { CounterPoint } from '@open-nexlev/niche-engine';

export type CaptureJobView = {
  id: string;
  status: string;
  error: string | null;
  cancelRequested: boolean;
};

export function formatAccumulatedViews(value: number | null): string {
  return value == null ? '—' : value.toLocaleString();
}

export function precisionLabel(precision: CounterPoint['precision']): string {
  if (precision === 'exact') return 'exacta';
  if (precision === 'rounded') return 'redondeada';
  return 'desconocida';
}

export function isJobActive(job: CaptureJobView): boolean {
  return job.status === 'queued' || job.status === 'running';
}

export function jobFromCancel(response: { id: string; status: string; cancelRequested?: boolean }): CaptureJobView {
  const status = response.status;
  return {
    id: response.id,
    status,
    error: null,
    cancelRequested: Boolean(response.cancelRequested) && (status === 'queued' || status === 'running'),
  };
}

export function jobFromPoll(previous: CaptureJobView, next: { id: string; status: string; error?: string | null }): CaptureJobView {
  const status = next.status;
  return {
    id: next.id,
    status,
    error: next.error ?? null,
    cancelRequested: status === 'queued' || status === 'running' ? previous.cancelRequested : false,
  };
}

export function jobHeadline(job: CaptureJobView): string {
  if (job.cancelRequested && isJobActive(job)) return `${job.id} (cancelación solicitada)`;
  return `${job.id} (${job.status}${job.error ? ` · ${job.error}` : ''})`;
}
