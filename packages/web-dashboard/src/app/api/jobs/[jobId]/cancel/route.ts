import { NextRequest, NextResponse } from 'next/server';
import { authorizeLocalWrite } from '../../../../../http/guard';
import { getStore } from '../../../../../db/store';
import { cancelJob } from '../../../../../services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const auth = authorizeLocalWrite(req.headers.get('host'), req.headers.get('origin'));
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
  const { jobId } = await ctx.params;
  const job = cancelJob(getStore().sqlite, jobId);
  if (!job) return NextResponse.json({ ok: false, error: 'Trabajo no encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true, job: { id: job.id, status: job.status, cancelRequested: job.cancel_requested === 1 } });
}
