import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardWrite } from '../../../http/guard';
import { httpError } from '../../../http/errors';
import { getStore } from '../../../db/store';
import { createProject, listProjects } from '../../../services/research';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const weights = z.object({ traction: z.number().int().nonnegative(), outliers: z.number().int().nonnegative(), growth: z.number().int().nonnegative(), competition: z.number().int().nonnegative() });
const body = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  market: z.string().max(80).optional(),
  language: z.string().max(20).optional(),
  referenceQueries: z.array(z.string().trim().min(1).max(200)).max(20),
  competitionQueries: z.array(z.string().trim().min(1).max(200)).max(20),
  weights: weights.optional(),
  competitorMedianThreshold: z.number().finite().nonnegative().optional(),
  maxResults: z.number().int().min(1).max(20).optional(),
  uploadDate: z.enum(['month', 'year', 'all']).optional(),
});

export async function GET() {
  return NextResponse.json({ ok: true, projects: listProjects(getStore().sqlite) });
}

export async function POST(req: NextRequest) {
  const guarded = await guardWrite(req, body);
  if (!guarded.ok) return guarded.response;
  try { return NextResponse.json({ ok: true, project: createProject(getStore().sqlite, guarded.data) }); }
  catch (error) { return httpError(error); }
}
