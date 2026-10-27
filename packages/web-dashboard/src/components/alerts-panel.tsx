'use client';
import React, { useEffect, useState } from 'react';

type Alert = { id: string; type: string; channelId: string; videoId: string | null; createdAt: string; readAt: string | null; evidence: { note?: string; ratio?: number; median?: number; sampleIds?: string[] } };

export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [type, setType] = useState('');
  async function load(unread = unreadOnly, selected = type) {
    const params = new URLSearchParams();
    if (unread) params.set('unread', '1');
    if (selected) params.set('type', selected);
    const response = await fetch(`/api/alerts?${params}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudieron leer las alertas');
    setAlerts(data.alerts);
  }
  useEffect(() => { load().catch(err => setError(err.message)); }, []);
  return (
    <section style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Alertas ({alerts.length})</h2>
      <p style={{ color: '#94a3b8', fontSize: 13 }}>Solo dentro de la aplicación. Un cruce de umbral genera una alerta, no una por cada reintento.</p>
      {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => { setUnreadOnly(true); load(true, type).catch(err => setError(err.message)); }}>No leídas</button>
        <button type="button" onClick={() => { setUnreadOnly(false); load(false, type).catch(err => setError(err.message)); }}>Todas</button>
        <select aria-label="Tipo de alerta" value={type} onChange={event => { setType(event.target.value); load(unreadOnly, event.target.value).catch(err => setError(err.message)); }}>
          <option value="">Todos los tipos</option>
          <option value="baseline_outlier">Hallazgo inicial</option>
          <option value="new_outlier">Nuevo outlier</option>
          <option value="acceleration">Aceleración</option>
          <option value="capture_failed">Captura fallida</option>
        </select>
      </div>
      {alerts.map(alert => (
        <article key={alert.id} style={{ borderTop: '1px solid #1f2937', padding: '12px 0' }}>
          <strong>{alert.type === 'baseline_outlier' ? 'Hallazgo inicial' : alert.type === 'new_outlier' ? 'Nuevo outlier' : alert.type === 'acceleration' ? 'Aceleración observada' : 'Capturas fallidas'}</strong>
          <div style={{ fontSize: 13, color: '#cbd5e1' }}>{alert.channelId} · {new Date(alert.createdAt).toLocaleString()} {alert.readAt ? `· leída ${new Date(alert.readAt).toLocaleString()}` : ''}</div>
          <p>{alert.evidence.note} {alert.evidence.ratio != null ? `Ratio ${alert.evidence.ratio.toFixed(2)} sobre mediana ${alert.evidence.median}.` : ''}</p>
          {alert.videoId && <a href={`https://www.youtube.com/watch?v=${alert.videoId}`} target="_blank" rel="noreferrer">Abrir video</a>}
          {!alert.readAt && <button type="button" style={{ marginLeft: 8 }} onClick={async () => { setError(''); try { const response = await fetch(`/api/alerts/${alert.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ read: true }) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>Marcar leída</button>}
        </article>
      ))}
      {alerts.length === 0 && <p>No hay alertas en este filtro.</p>}
    </section>
  );
}
