'use client';
import React, { useEffect, useState } from 'react';

type WindowMetric = { quality: string; delta: number | null; explanation: string; projected: boolean; observedDays: number | null; from: string | null; to: string | null };
type Channel = { channelId: string; title: string; active: boolean; provider: string; nextDueAt: string; lastSuccessAt: string | null; lastError: string | null; quality: string; intervalHours: number };

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || 'La solicitud falló');
  return data;
}

export function TrackingPanel() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<any>(null);
  const [job, setJob] = useState<string>('');
  const load = () => api('/api/tracking').then(data => setChannels(data.channels)).catch(err => setError(err.message));
  useEffect(() => { load(); }, []);
  return (
    <section style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Seguimiento</h2>
      <p style={{ color: '#94a3b8', fontSize: 13 }}>Guardar en el Swipe File no sigue el canal. Seguir conserva observaciones; dejar de seguir no las borra.</p>
      {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
      <form onSubmit={async event => { event.preventDefault(); setError(''); try { await api('/api/tracking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId }) }); setChannelId(''); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input aria-label="ID de canal a seguir" value={channelId} onChange={event => setChannelId(event.target.value)} placeholder="UCxxxxxxxxxxxxxxxxxxxxxx" style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #374151', background: '#030712', color: '#fff' }} />
        <button style={{ padding: '10px 14px', border: 0, borderRadius: 8, background: '#7c3aed', color: '#fff', fontWeight: 700 }}>Seguir canal</button>
      </form>
      {channels.map(channel => (
        <article key={channel.channelId} style={{ borderTop: '1px solid #1f2937', padding: '12px 0' }}>
          <strong>{channel.title}</strong> <span style={{ color: '#94a3b8' }}>{channel.channelId}</span>
          <div style={{ color: '#cbd5e1', fontSize: 13, margin: '6px 0' }}>
            {channel.active ? 'Activo' : 'Pausado'} · {channel.provider} · calidad: {channel.quality} · próximo vencimiento: {new Date(channel.nextDueAt).toLocaleString()} · último éxito: {channel.lastSuccessAt ? new Date(channel.lastSuccessAt).toLocaleString() : 'nunca'} {channel.lastError ? `· último error: ${channel.lastError}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={async () => { setError(''); try { const data = await api(`/api/tracking/${channel.channelId}/refresh`, { method: 'POST' }); setJob(`${data.jobId} (${data.status}${data.created ? '' : ', ya en curso'})`); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>Actualizar ahora</button>
            <button type="button" onClick={async () => { setError(''); try { setHistory((await api(`/api/tracking/${channel.channelId}/history?window=7d`)).history); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>Ver historial</button>
            <button type="button" onClick={async () => { setError(''); try { await api(`/api/tracking/${channel.channelId}`, { method: 'DELETE' }); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>Dejar de seguir</button>
            <button type="button" onClick={async () => { if (!confirm('Esto borra las observaciones de este canal.')) return; setError(''); try { await api(`/api/tracking/${channel.channelId}/history`, { method: 'DELETE' }); setHistory(null); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>Borrar historial</button>
          </div>
        </article>
      ))}
      {job && <p>Trabajo: {job}. La captura no bloquea esta página.</p>}
      {history && (
        <div style={{ marginTop: 16 }}>
          <h3>Historial {history.channelId}</h3>
          <p>{history.note}</p>
          {history.points.length === 0 && <p>Sin historial todavía.</p>}
          {(['h24', 'd7', 'd30'] as const).map(key => {
            const window = history.windows[key] as WindowMetric;
            return <p key={key}><strong>{key}:</strong> {window.quality} · delta {window.delta ?? '—'} · {window.explanation}</p>;
          })}
          {history.windows.projection && <p><strong>Proyección:</strong> {history.windows.projection.explanation}</p>}
        </div>
      )}
    </section>
  );
}
