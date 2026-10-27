import { NextRequest, NextResponse } from 'next/server';
import { authorizeLocalWrite } from '../../../../../http/guard';
import { httpError } from '../../../../../http/errors';
import { getStore } from '../../../../../db/store';
import { channelHistory, deleteHistory } from '../../../../../services/tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ channelId: string }> }) {
  try {
    const { channelId } = await ctx.params;
    const requested = new URL(req.url).searchParams.get('window');
    const window = requested === '1d' || requested === '24h' ? '1' : requested === '30d' ? '30' : '7';
    return NextResponse.json({ ok: true, history: channelHistory(getStore().sqlite, channelId, window) });
  } catch (error) { return httpError(error); }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ channelId: string }> }) {
  const auth = authorizeLocalWrite(req.headers.get('host'), req.headers.get('origin'));
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
  try {
    const { channelId } = await ctx.params;
    deleteHistory(getStore().sqlite, channelId);
    return NextResponse.json({ ok: true });
  } catch (error) { return httpError(error); }
}
