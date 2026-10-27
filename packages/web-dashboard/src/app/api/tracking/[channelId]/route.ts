import { NextRequest, NextResponse } from 'next/server';
import { authorizeLocalWrite } from '../../../../http/guard';
import { httpError } from '../../../../http/errors';
import { getStore } from '../../../../db/store';
import { unfollowChannel } from '../../../../services/tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ channelId: string }> }) {
  const auth = authorizeLocalWrite(req.headers.get('host'), req.headers.get('origin'));
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
  try {
    const { channelId } = await ctx.params;
    return NextResponse.json({ ok: true, channel: unfollowChannel(getStore().sqlite, channelId) });
  } catch (error) { return httpError(error); }
}
