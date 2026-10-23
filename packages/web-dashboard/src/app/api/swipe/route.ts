import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStore } from '../../../db/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const metric = z.number().finite().nonnegative();
const channel = z.object({
  channelId: z.string().regex(/^UC[\w-]{22}$/), title: z.string().min(1).max(1000),
  handle: z.string().max(1000), subscribers: metric, medianViews: metric,
  subscriberToViewRatio: metric,
  estimatedMonthlyRevenueUsd: z.object({ low: metric, high: metric }),
  channelUrl: z.string().url().refine(url => /^https:\/\/www\.youtube\.com\/channel\/UC[\w-]{22}$/.test(url)),
  topOutliers: z.array(z.object({
    id: z.string().regex(/^[\w-]{11}$/), title: z.string().max(1000), views: metric,
    publishedText: z.string().max(200), outlierScore: metric, viewsToSubsRatio: metric,
    url: z.string().url().refine(url => /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(url)),
    thumbnailUrl: z.string().url().refine(url => /^https:\/\/i\.ytimg\.com\//.test(url)),
  })).max(100),
});
function failure(error: unknown) {
  console.error('Swipe File:', error instanceof Error ? error.message : 'Database failure');
  return NextResponse.json({ ok: false, error: 'No se pudo acceder al Swipe File. Revisa la ruta y permisos de SQLite.' }, { status: 500 });
}
export async function GET() {
  try { return NextResponse.json({ ok: true, channels: getStore().list() }); } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  // This local application has no accounts. Reject writes from another origin.
  const origin = req.headers.get('origin');
  if (origin) {
    let allowed = false;
    try { const source = new URL(origin); allowed = ['http:', 'https:'].includes(source.protocol) && source.host === req.headers.get('host'); } catch { /* Invalid Origin */ }
    if (!allowed) return NextResponse.json({ ok: false, error: 'Origen no permitido' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = z.discriminatedUnion('action', [
    z.object({ action: z.literal('save'), channel }),
    z.object({ action: z.literal('remove'), channelId: channel.shape.channelId }),
    z.object({ action: z.literal('import'), channels: z.array(channel).max(500) }),
  ]).safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Datos de canal inválidos' }, { status: 400 });
  try {
    const store = getStore(); const data = parsed.data;
    if (data.action === 'save') store.save(data.channel);
    else if (data.action === 'remove') store.remove(data.channelId);
    else store.import(data.channels);
    return NextResponse.json({ ok: true, channels: store.list() });
  } catch (error) { return failure(error); }
}
