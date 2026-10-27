import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardWrite } from '../../../../http/guard';
import { getStore } from '../../../../db/store';
import { markAlert } from '../../../../services/alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guarded = await guardWrite(req, z.object({ read: z.boolean() }));
  if (!guarded.ok) return guarded.response;
  const { id } = await ctx.params;
  const alert = markAlert(getStore().sqlite, id, guarded.data.read);
  if (!alert) return NextResponse.json({ ok: false, error: 'Alerta no encontrada' }, { status: 404 });
  return NextResponse.json({ ok: true, alert });
}
