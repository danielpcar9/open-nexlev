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
    <section className="panel">
      <h2>Seguimiento</h2>
      <p className="lede">Guardar en el Swipe File no sigue el canal. Seguir conserva observaciones; dejar de seguir no las borra.</p>
      {error && <p role="alert" className="alert">{error}</p>}
      <form className="inline" onSubmit={async event => { event.preventDefault(); setError(''); try { await api('/api/tracking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId }) }); setChannelId(''); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>
        <label className="field">
          <span>Canal</span>
          <input aria-label="ID de canal a seguir" value={channelId} onChange={event => setChannelId(event.target.value)} placeholder="UCxxxxxxxxxxxxxxxxxxxxxx" />
        </label>
        <button className="btn primary" type="submit">Seguir canal</button>
      </form>
      {channels.map(channel => (
        <article className="row" key={channel.channelId}>
          <strong>{channel.title}</strong>
          <span className="meta num">{channel.channelId}</span>
          <p className="meta">
            {channel.active ? 'Activo' : 'Pausado'} · {channel.provider} · calidad: {channel.quality} · próximo vencimiento: {new Date(channel.nextDueAt).toLocaleString()} · último éxito: {channel.lastSuccessAt ? new Date(channel.lastSuccessAt).toLocaleString() : 'nunca'} {channel.lastError ? `· último error: ${channel.lastError}` : ''}
          </p>
          <div className="toolbar">
            <button className="btn tiny" type="button" onClick={async () => { setError(''); try { const data = await api(`/api/tracking/${channel.channelId}/refresh`, { method: 'POST' }); setJob(`${data.jobId} (${data.status}${data.created ? '' : ', ya en curso'})`); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>Actualizar ahora</button>
            <button className="btn tiny" type="button" onClick={async () => { setError(''); try { setHistory((await api(`/api/tracking/${channel.channelId}/history?window=7d`)).history); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>Ver historial</button>
            <button className="btn tiny" type="button" onClick={async () => { setError(''); try { await api(`/api/tracking/${channel.channelId}`, { method: 'DELETE' }); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>Dejar de seguir</button>
            <button className="btn tiny" type="button" onClick={async () => { if (!confirm('Esto borra las observaciones de este canal.')) return; setError(''); try { await api(`/api/tracking/${channel.channelId}/history`, { method: 'DELETE' }); setHistory(null); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>Borrar historial</button>
          </div>
        </article>
      ))}
      {channels.length === 0 && <p className="empty">Ningún canal en seguimiento.</p>}
      {job && <p className="meta">Trabajo: <span className="num">{job}</span>. La captura no bloquea esta página.</p>}
      {history && (
        <div>
          <h3>Historial <span className="num">{history.channelId}</span></h3>
          <p className="lede">{history.note}</p>
          {history.points.length === 0 && <p className="empty">Sin historial todavía.</p>}
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
