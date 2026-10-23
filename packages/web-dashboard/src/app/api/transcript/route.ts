import { NextRequest, NextResponse } from 'next/server';
import { NicheFinderEngine } from '@open-nexlev/niche-engine';

const engine = new NicheFinderEngine();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const videoIdOrUrl = body?.videoIdOrUrl;
    if (typeof videoIdOrUrl !== 'string' || !videoIdOrUrl.trim() || videoIdOrUrl.length > 2048) {
      return NextResponse.json({ ok: false, error: 'Falta videoIdOrUrl' }, { status: 400 });
    }

    const transcript = await engine.getVideoTranscript(videoIdOrUrl);
    if (!transcript) {
      return NextResponse.json(
        { ok: false, error: 'No se encontraron subtítulos para este video' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, transcript });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Error extrayendo transcripción' },
      { status: 500 }
    );
  }
}
