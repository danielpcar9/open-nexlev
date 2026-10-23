import type { TranscriptSegment, VideoTranscriptResult } from './index.js';
export type TranscriptErrorCode = 'INVALID_VIDEO' | 'VIDEO_UNAVAILABLE' | 'NO_CAPTIONS' | 'UPSTREAM_ERROR' | 'TIMEOUT';
export class TranscriptError extends Error {
  constructor(public readonly code: TranscriptErrorCode, message: string) { super(message); this.name = 'TranscriptError'; }
}
export function parseVideoId(input: string): string {
  const value = input.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0] ?? null;
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
    }
    if (id && /^[\w-]{11}$/.test(id)) return id;
  } catch { /* Produce the same actionable error for all malformed inputs. */ }
  throw new TranscriptError('INVALID_VIDEO', 'Introduce una URL de YouTube válida o un ID de 11 caracteres.');
}
type Json3 = { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> };
export function parseJson3(data: Json3): TranscriptSegment[] {
  return (data.events ?? []).flatMap(event => {
    const text = (event.segs ?? []).map(segment => segment.utf8 ?? '').join('').replace(/\s+/g, ' ').trim();
    const startMs = event.tStartMs;
    const duration = event.dDurationMs ?? 0;
    if (!text || typeof startMs !== 'number' || !Number.isFinite(startMs) || startMs < 0 || !Number.isFinite(duration) || duration < 0) return [];
    const seconds = Math.floor(startMs / 1000);
    return [{ startMs, endMs: startMs + duration, timestamp: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`, text }];
  });
}
type Player = {
  playabilityStatus?: { status?: string };
  videoDetails?: { title?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Array<{ baseUrl: string; languageCode: string; kind?: string }> } };
};
export async function fetchVideoTranscript(input: string, fetcher: typeof fetch = fetch): Promise<VideoTranscriptResult> {
  const videoId = parseVideoId(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetcher(url, { ...init, signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new TranscriptError('UPSTREAM_ERROR', `YouTube rechazó la solicitud (${response.status}). Intenta nuevamente más tarde.`);
    const text = await response.text();
    if (!text.trim()) throw new TranscriptError('UPSTREAM_ERROR', 'YouTube devolvió subtítulos vacíos. Intenta nuevamente más tarde.');
    try { return JSON.parse(text) as T; }
    catch { throw new TranscriptError('UPSTREAM_ERROR', 'YouTube devolvió una respuesta de subtítulos no válida.'); }
  }
  try {
    // Fetch only player metadata: unrelated recommendation renderers must not break captions.
    const player = await request<Player>('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '21.03.36', hl: 'en', gl: 'US' } }, videoId }),
    });
    if (player.playabilityStatus?.status !== 'OK') throw new TranscriptError('VIDEO_UNAVAILABLE', 'Este video no está disponible públicamente o requiere iniciar sesión.');
    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    if (!tracks.length) throw new TranscriptError('NO_CAPTIONS', 'Este video no tiene pistas de subtítulos disponibles.');
    const track = tracks.find(item => item.kind !== 'asr') ?? tracks[0];
    if (!track) throw new TranscriptError('NO_CAPTIONS', 'No hay pistas de subtítulos.');
    const url = new URL(track.baseUrl);
    if (url.protocol !== 'https:' || !(url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) || url.pathname !== '/api/timedtext')
      throw new TranscriptError('UPSTREAM_ERROR', 'YouTube devolvió una dirección de subtítulos no válida.');
    url.searchParams.set('fmt', 'json3');
    const segments = parseJson3(await request<Json3>(url.toString(), { redirect: 'error' }));
    if (!segments.length) throw new TranscriptError('UPSTREAM_ERROR', 'La pista de subtítulos no contiene segmentos legibles.');
    const cleanText = segments.map(segment => segment.text).join(' ');
    return { videoId, title: player.videoDetails?.title || videoId, cleanText, wordCount: cleanText.split(/\s+/).length, segments };
  } catch (error) {
    if (error instanceof TranscriptError) throw error;
    if (controller.signal.aborted) throw new TranscriptError('TIMEOUT', 'YouTube tardó demasiado en responder. Intenta nuevamente.');
    throw new TranscriptError('UPSTREAM_ERROR', 'No se pudo conectar con los subtítulos de YouTube. Intenta nuevamente más tarde.');
  } finally { clearTimeout(timer); }
}
