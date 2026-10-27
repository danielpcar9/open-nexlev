import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '../../../db/store';
import { listAlerts } from '../../../services/alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
  const result = listAlerts(getStore().sqlite, {
    channelId: url.searchParams.get('channelId') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    unread: url.searchParams.get('unread') === '1',
    limit,
    cursor: url.searchParams.get('cursor'),
  });
  return NextResponse.json({ ok: true, ...result });
}
