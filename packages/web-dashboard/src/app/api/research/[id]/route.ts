import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardWrite } from '../../../../http/guard';
import { httpError } from '../../../../http/errors';
import { getStore } from '../../../../db/store';
import { getProject, patchProject } from '../../../../services/research';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const weights = z.object({ traction: z.number().int().nonnegative(), outliers: z.number().int().nonnegative(), growth: z.number().int().nonnegative(), competition: z.number().int().nonnegative() });
const body = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  market: z.string().max(80).nullable().optional(),
  language: z.string().max(20).nullable().optional(),
  weights: weights.optional(),
  competitorMedianThreshold: z.number().finite().nonnegative().optional(),
  queries: z.array(z.object({ role: z.enum(['reference', 'competition']), query: z.string().trim().min(1).max(200) })).max(20).optional(),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json({ ok: true, project: getProject(getStore().sqlite, (await ctx.params).id) }); }
  catch (error) { return httpError(error); }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guarded = await guardWrite(req, body);
  if (!guarded.ok) return guarded.response;
  try { return NextResponse.json({ ok: true, project: patchProject(getStore().sqlite, (await ctx.params).id, guarded.data) }); }
  catch (error) { return httpError(error); }
}
