import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardWrite } from '../../../http/guard';
import { httpError } from '../../../http/errors';
import { getStore } from '../../../db/store';
import { followChannel, listTracked } from '../../../services/tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({
  channelId: z.string().regex(/^UC[\w-]{22}$/),
  intervalHours: z.number().int().min(1).max(168).optional(),
  title: z.string().max(200).optional(),
  provider: z.enum(['innertube', 'youtube-data-api']).optional(),
});

export async function GET() {
  try { return NextResponse.json({ ok: true, channels: listTracked(getStore().sqlite) }); }
  catch (error) { return httpError(error); }
}

export async function POST(req: NextRequest) {
  const guarded = await guardWrite(req, body);
  if (!guarded.ok) return guarded.response;
  try { return NextResponse.json({ ok: true, channel: followChannel(getStore().sqlite, guarded.data) }); }
  catch (error) { return httpError(error); }
}
