import { NextRequest, NextResponse } from 'next/server';
import { NicheFinderEngine } from '@open-nexlev/niche-engine';

const engine = new NicheFinderEngine();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || typeof body.query !== "string" || !body.query.trim() || body.query.length > 200) return NextResponse.json({ ok: false, error: "Consulta inválida" }, { status: 400 });
    for (const key of ["maxSubscribers", "minOutlierScore", "minMedianViews", "maxChannelsToAnalyze"]) {
      if (body[key] !== undefined && (typeof body[key] !== "number" || !Number.isFinite(body[key]) || body[key] < 0)) return NextResponse.json({ ok: false, error: "Filtro inválido" }, { status: 400 });
    }
    if (body.maxChannelsToAnalyze !== undefined && (!Number.isInteger(body.maxChannelsToAnalyze) || body.maxChannelsToAnalyze < 1 || body.maxChannelsToAnalyze > 20)) return NextResponse.json({ ok: false, error: "Usa entre 1 y 20 canales" }, { status: 400 });
    const {
      query = 'stoicism',
      maxSubscribers = 50000,
      minOutlierScore = 3.0,
      minMedianViews = 5000,
      maxChannelsToAnalyze = 10,
    } = body;

    const channels = await engine.discoverNicheChannels({
      query,
      maxSubscribers: Number(maxSubscribers),
      minOutlierScore: Number(minOutlierScore),
      minMedianViews: Number(minMedianViews),
      maxChannelsToAnalyze: Number(maxChannelsToAnalyze),
    });

    return NextResponse.json({ ok: true, count: channels.length, channels });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Error ejecutando el Niche Crawler' },
      { status: 500 }
    );
  }
}
