import { NextRequest, NextResponse } from 'next/server';
import { authorizeLocalWrite } from '../../../../../http/guard';
import { httpError } from '../../../../../http/errors';
import { getStore } from '../../../../../db/store';
import { queueResearch } from '../../../../../services/research';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = authorizeLocalWrite(req.headers.get('host'), req.headers.get('origin'));
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
  try {
    const job = queueResearch(getStore().sqlite, (await ctx.params).id);
    return NextResponse.json({ ok: true, ...job }, { status: 202 });
  } catch (error) { return httpError(error); }
}
