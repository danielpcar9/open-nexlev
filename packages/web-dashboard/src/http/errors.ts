import { NextResponse } from 'next/server';
import { HttpError } from '../services/tracking';

export function httpError(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  if (error instanceof Error && /pesos|sumar 100|enteros/i.test(error.message)) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  console.error(error instanceof Error ? error.name : 'api');
  return NextResponse.json({ ok: false, error: 'No se pudo completar la operación.' }, { status: 500 });
}
