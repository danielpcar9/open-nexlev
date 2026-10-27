import { NextRequest, NextResponse } from 'next/server';
import type { ZodType } from 'zod';

export const MAX_BODY_BYTES = 1024 * 1024;

export function allowedHosts(port = process.env.PORT || '3000'): Set<string> {
  const extra = (process.env.ALLOWED_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`, ...extra]);
}

export function authorizeLocalWrite(host: string | null, origin: string | null, port = process.env.PORT || '3000'): { ok: true } | { ok: false; status: 403; error: string } {
  if (!host || !allowedHosts(port).has(host.toLowerCase())) return { ok: false, status: 403, error: 'Host no autorizado' };
  if (!origin) return { ok: true };
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || !allowedHosts(port).has(url.host.toLowerCase())) return { ok: false, status: 403, error: 'Origen no permitido' };
  } catch {
    return { ok: false, status: 403, error: 'Origen no permitido' };
  }
  return { ok: true };
}

export async function readLimitedText(req: { headers: { get(name: string): string | null }; text(): Promise<string> }): Promise<{ ok: true; text: string } | { ok: false; status: 400 | 413; error: string }> {
  const declared = req.headers.get('content-length');
  if (declared != null) {
    if (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES) {
      return { ok: false, status: Number(declared) > MAX_BODY_BYTES ? 413 : 400, error: Number(declared) > MAX_BODY_BYTES ? 'El cuerpo supera 1 MiB' : 'Content-Length inválido' };
    }
  }
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'El cuerpo supera 1 MiB' };
  return { ok: true, text };
}

export async function guardWrite<T>(req: NextRequest, schema: ZodType<T>, invalidMessage = 'Datos inválidos'): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const auth = authorizeLocalWrite(req.headers.get('host'), req.headers.get('origin'));
  if (!auth.ok) return { ok: false, response: NextResponse.json({ ok: false, error: auth.error }, { status: 403 }) };
  const body = await readLimitedText(req);
  if (!body.ok) return { ok: false, response: NextResponse.json({ ok: false, error: body.error }, { status: body.status }) };
  let json: unknown;
  try { json = body.text ? JSON.parse(body.text) : null; }
  catch { return { ok: false, response: NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }) }; }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, response: NextResponse.json({ ok: false, error: invalidMessage }, { status: 400 }) };
  return { ok: true, data: parsed.data };
}
