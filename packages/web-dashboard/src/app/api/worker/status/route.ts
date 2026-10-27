import { NextResponse } from 'next/server';
import { getStore } from '../../../../db/store';
import { workerStatus } from '../../../../services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const status = workerStatus(getStore().sqlite);
  return NextResponse.json({ ok: true, ...status, command: 'npm run worker' });
}
