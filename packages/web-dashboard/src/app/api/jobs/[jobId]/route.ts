import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '../../../../db/store';
import { getJob } from '../../../../services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const job = getJob(getStore().sqlite, jobId);
  if (!job) return NextResponse.json({ ok: false, error: 'Trabajo no encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true, job: { id: job.id, type: job.type, status: job.status, progress: job.progress, error: job.error, attempts: job.attempts, createdAt: new Date(job.created_at).toISOString(), finishedAt: job.finished_at ? new Date(job.finished_at).toISOString() : null } });
}
