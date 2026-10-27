import { NextRequest, NextResponse } from 'next/server';
import { NicheFinderEngine } from '@open-nexlev/niche-engine';
import { authorizeLocalWrite, readLimitedText } from '../../../http/guard';
import { getStore } from '../../../db/store';
import { recordAnalysisRun } from '../../../services/capture';

const engine = new NicheFinderEngine();
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = authorizeLocalWrite(req.headers.get('host'), req.headers.get('origin'));
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
  const limited = await readLimitedText(req);
  if (!limited.ok) return NextResponse.json({ ok: false, error: limited.error }, { status: limited.status });
  const startedAt = Date.now();
  let body: any = null;
  try { body = limited.text ? JSON.parse(limited.text) : null; }
  catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }); }
  try {
    if (!body || typeof body !== 'object' || typeof body.query !== 'string' || !body.query.trim() || body.query.length > 200) return NextResponse.json({ ok: false, error: 'Consulta inválida' }, { status: 400 });
    for (const key of ['maxSubscribers', 'minOutlierScore', 'minMedianViews', 'maxChannelsToAnalyze']) {
      if (body[key] !== undefined && (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < 0)) return NextResponse.json({ ok: false, error: 'Filtro inválido' }, { status: 400 });
    }
    if (body.maxChannelsToAnalyze !== undefined && (!Number.isInteger(body.maxChannelsToAnalyze) || body.maxChannelsToAnalyze < 1 || body.maxChannelsToAnalyze > 20)) return NextResponse.json({ ok: false, error: 'Usa entre 1 y 20 canales' }, { status: 400 });
    const {
      query = 'stoicism',
      maxSubscribers = 50000,
      minOutlierScore = 3.0,
      minMedianViews = 5000,
      maxChannelsToAnalyze = 10,
    } = body;
    const filters = { query, maxSubscribers: Number(maxSubscribers), minOutlierScore: Number(minOutlierScore), minMedianViews: Number(minMedianViews), maxChannelsToAnalyze: Number(maxChannelsToAnalyze) };
    const channels = await engine.discoverNicheChannels(filters);
    try { recordAnalysisRun(getStore().sqlite, { query, filters, status: 'complete', provider: 'innertube', startedAt, finishedAt: Date.now() }); } catch { /* La búsqueda ya terminó; el registro no debe ocultar el resultado. */ }
    return NextResponse.json({ ok: true, count: channels.length, channels, note: 'Muestra de la consulta, no todo el mercado.' });
  } catch (error: any) {
    try { recordAnalysisRun(getStore().sqlite, { query: typeof body?.query === 'string' ? body.query : '', filters: {}, status: 'failed', provider: 'innertube', error: 'UPSTREAM', startedAt, finishedAt: Date.now() }); } catch { /* ignore */ }
    return NextResponse.json(
      { ok: false, error: error?.message || 'Error ejecutando el Niche Crawler' },
      { status: 500 }
    );
  }
}
