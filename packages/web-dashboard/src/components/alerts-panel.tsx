'use client';
import React, { useEffect, useState } from 'react';

type Alert = {
  id: string;
  type: string;
  channelId: string;
  videoId: string | null;
  createdAt: string;
  readAt: string | null;
  evidence: {
    note?: string;
    ratio?: number;
    median?: number;
    sampleIds?: string[];
  };
};

const labels: Record<string, string> = {
  baseline_outlier: 'Hallazgo inicial',
  new_outlier: 'Nuevo outlier',
  acceleration: 'Aceleración observada',
  capture_failed: 'Capturas fallidas',
};

const badgeTone: Record<string, string> = {
  baseline_outlier: 'pill-info',
  new_outlier: 'pill-hot',
  acceleration: 'pill-emerald',
  capture_failed: 'pill-danger',
};

const typeFilters = [
  ['', 'Todos los tipos'],
  ['baseline_outlier', 'Hallazgo inicial'],
  ['new_outlier', 'Nuevo outlier'],
  ['acceleration', 'Aceleración'],
  ['capture_failed', 'Captura fallida'],
] as const;

export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [type, setType] = useState('');

  async function load(unread = unreadOnly, selected = type) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (unread) params.set('unread', '1');
      if (selected) params.set('type', selected);
      const response = await fetch(`/api/alerts?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'No se pudieron leer las alertas');
      }
      setAlerts(data.alerts);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(err => setError(err.message));
  }, []);

  const markAsRead = async (id: string) => {
    setError('');
    try {
      const response = await fetch(`/api/alerts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const markAllRead = async () => {
    const unread = alerts.filter(a => !a.readAt);
    if (unread.length === 0) return;
    setError('');
    try {
      await Promise.all(
        unread.map(a =>
          fetch(`/api/alerts/${a.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ read: true }),
          })
        )
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al marcar alertas');
    }
  };

  const unreadCount = alerts.filter(a => !a.readAt).length;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Centro de señales</div>
          <h2>
            Alertas <span className="count-badge">{alerts.length}</span>
          </h2>
          <p className="lede">
            Solo dentro de la aplicación. Un cruce de umbral genera una alerta única, no una por cada reintento.
          </p>
        </div>
        {unreadCount > 0 && (
          <button className="btn subtle" type="button" onClick={markAllRead}>
            Marcar visibles como leídas ({unreadCount})
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}

      <div className="toolbar alerts-toolbar">
        <div className="segmented" role="group" aria-label="Estado de lectura">
          <button
            className={unreadOnly ? 'seg-btn active' : 'seg-btn'}
            type="button"
            onClick={() => {
              setUnreadOnly(true);
              load(true, type).catch(err => setError(err.message));
            }}
          >
            No leídas
          </button>
          <button
            className={!unreadOnly ? 'seg-btn active' : 'seg-btn'}
            type="button"
            onClick={() => {
              setUnreadOnly(false);
              load(false, type).catch(err => setError(err.message));
            }}
          >
            Todas
          </button>
        </div>

        <div className="filter-pills">
          {typeFilters.map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={type === val ? 'chip active' : 'chip'}
              onClick={() => {
                setType(val);
                load(unreadOnly, val).catch(err => setError(err.message));
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          aria-label="Tipo de alerta"
          className="sr-select"
          value={type}
          onChange={event => {
            setType(event.target.value);
            load(unreadOnly, event.target.value).catch(err => setError(err.message));
          }}
        >
          <option value="">Todos los tipos</option>
          <option value="baseline_outlier">Hallazgo inicial</option>
          <option value="new_outlier">Nuevo outlier</option>
          <option value="acceleration">Aceleración</option>
          <option value="capture_failed">Captura fallida</option>
        </select>
      </div>

      <div className="alert-cards">
        {alerts.map(alert => (
          <article
            className={alert.readAt ? 'alert-card is-read' : 'alert-card is-unread'}
            key={alert.id}
          >
            <div className="alert-card-top">
              <div className="alert-card-title">
                <span className={`pill ${badgeTone[alert.type] ?? 'pill-info'}`}>
                  {labels[alert.type] ?? alert.type}
                </span>
                <span className="num mono-tag">{alert.channelId}</span>
                {alert.evidence.ratio != null && (
                  <span className="pill pill-accent num">
                    {alert.evidence.ratio.toFixed(2)}× ratio
                  </span>
                )}
                {alert.evidence.median != null && (
                  <span className="meta num">
                    Mediana: {alert.evidence.median.toLocaleString()} vistas
                  </span>
                )}
              </div>
              <div className="meta num">
                {new Date(alert.createdAt).toLocaleString()}
                {alert.readAt ? ` · Leída ${new Date(alert.readAt).toLocaleString()}` : ''}
              </div>
            </div>

            <p className="alert-card-body">
              {alert.evidence.note}{' '}
              {alert.evidence.ratio != null
                ? `Ratio ${alert.evidence.ratio.toFixed(2)} sobre mediana ${alert.evidence.median}.`
                : ''}
            </p>

            <div className="alert-card-actions">
              {alert.videoId && (
                <a
                  className="btn tiny"
                  href={`https://www.youtube.com/watch?v=${alert.videoId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir video en YouTube ↗
                </a>
              )}
              <a
                className="btn tiny subtle"
                href={`https://www.youtube.com/channel/${alert.channelId}`}
                target="_blank"
                rel="noreferrer"
              >
                Ver canal ↗
              </a>
              {!alert.readAt && (
                <button
                  className="btn tiny primary"
                  type="button"
                  onClick={() => markAsRead(alert.id)}
                >
                  Marcar leída
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {!loading && alerts.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🔔</div>
          <strong>No hay alertas en este filtro</strong>
          <p className="meta">
            Cuando el worker detecte un nuevo video outlier, aceleración de vistas o fallos de captura en tus canales seguidos, aparecerán aquí.
          </p>
        </div>
      )}
    </section>
  );
}
