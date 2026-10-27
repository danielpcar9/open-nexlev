import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardWrite } from '../../../../../../http/guard';
import { httpError } from '../../../../../../http/errors';
import { getStore } from '../../../../../../db/store';
import { patchMember } from '../../../../../../services/research';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({
  role: z.enum(['reference', 'direct_competitor', 'indirect_competitor', 'discarded']).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  language: z.string().max(20).nullable().optional(),
  languageEvidence: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; channelId: string }> }) {
  const guarded = await guardWrite(req, body);
  if (!guarded.ok) return guarded.response;
  try {
    const { id, channelId } = await ctx.params;
    return NextResponse.json({ ok: true, project: patchMember(getStore().sqlite, id, channelId, guarded.data) });
  } catch (error) { return httpError(error); }
}
