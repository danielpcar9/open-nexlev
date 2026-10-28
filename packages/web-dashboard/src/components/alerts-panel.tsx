'use client';
import React, { useEffect, useState } from 'react';

type Alert = { id: string; type: string; channelId: string; videoId: string | null; createdAt: string; readAt: string | null; evidence: { note?: string; ratio?: number; median?: number; sampleIds?: string[] } };

const labels: Record<string, string> = {
  baseline_outlier: 'Hallazgo inicial',
  new_outlier: 'Nuevo outlier',
  acceleration: 'Aceleración observada',
  capture_failed: 'Capturas fallidas',
};

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
    <section className="panel">
      <h2>Alertas <span className="count">{alerts.length}</span></h2>
      <p className="lede">Solo dentro de la aplicación. Un cruce de umbral genera una alerta, no una por cada reintento.</p>
      {error && <p role="alert" className="alert">{error}</p>}
      <div className="toolbar">
        <button className={unreadOnly ? 'btn primary' : 'btn'} type="button" onClick={() => { setUnreadOnly(true); load(true, type).catch(err => setError(err.message)); }}>No leídas</button>
        <button className={!unreadOnly ? 'btn primary' : 'btn'} type="button" onClick={() => { setUnreadOnly(false); load(false, type).catch(err => setError(err.message)); }}>Todas</button>
        <select aria-label="Tipo de alerta" value={type} onChange={event => { setType(event.target.value); load(unreadOnly, event.target.value).catch(err => setError(err.message)); }}>
          <option value="">Todos los tipos</option>
          <option value="baseline_outlier">Hallazgo inicial</option>
          <option value="new_outlier">Nuevo outlier</option>
          <option value="acceleration">Aceleración</option>
          <option value="capture_failed">Captura fallida</option>
        </select>
      </div>
      {alerts.map(alert => (
        <article className="row" key={alert.id}>
          <strong>{labels[alert.type] ?? alert.type}</strong>
          <div className="meta">{alert.channelId} · {new Date(alert.createdAt).toLocaleString()} {alert.readAt ? `· leída ${new Date(alert.readAt).toLocaleString()}` : ''}</div>
          <p>{alert.evidence.note} {alert.evidence.ratio != null ? `Ratio ${alert.evidence.ratio.toFixed(2)} sobre mediana ${alert.evidence.median}.` : ''}</p>
          <div className="toolbar">
            {alert.videoId && <a href={`https://www.youtube.com/watch?v=${alert.videoId}`} target="_blank" rel="noreferrer">Abrir video</a>}
            {!alert.readAt && <button className="btn tiny" type="button" onClick={async () => { setError(''); try { const response = await fetch(`/api/alerts/${alert.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ read: true }) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>Marcar leída</button>}
          </div>
        </article>
      ))}
      {alerts.length === 0 && <p className="empty">No hay alertas en este filtro.</p>}
    </section>
  );
}
