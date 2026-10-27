import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardWrite } from '../../../../http/guard';
import { httpError } from '../../../../http/errors';
import { getStore } from '../../../../db/store';
import { getRule, saveRule } from '../../../../services/alerts';
import { CHANNEL_ID } from '../../../../services/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({
  active: z.boolean(),
  multiplier: z.number().finite().positive().max(100),
  accelerationPercent: z.number().finite().nonnegative().max(100000),
  minViews: z.number().int().nonnegative(),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await ctx.params;
  if (!CHANNEL_ID.test(channelId)) return NextResponse.json({ ok: false, error: 'ID de canal inválido' }, { status: 400 });
  return NextResponse.json({ ok: true, rule: getRule(getStore().sqlite, channelId) });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ channelId: string }> }) {
  const guarded = await guardWrite(req, body);
  if (!guarded.ok) return guarded.response;
  try {
    const { channelId } = await ctx.params;
    if (!CHANNEL_ID.test(channelId)) return NextResponse.json({ ok: false, error: 'ID de canal inválido' }, { status: 400 });
    return NextResponse.json({ ok: true, rule: saveRule(getStore().sqlite, channelId, guarded.data) });
  } catch (error) { return httpError(error); }
}
