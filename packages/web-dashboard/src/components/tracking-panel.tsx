'use client';
import React, { useEffect, useState } from 'react';

type WindowMetric = {
  quality: string;
  delta: number | null;
  explanation: string;
  projected: boolean;
  observedDays: number | null;
  from: string | null;
  to: string | null;
};

type Channel = {
  channelId: string;
  title: string;
  active: boolean;
  provider: string;
  nextDueAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  quality: string;
  intervalHours: number;
};

type AlertRule = {
  active: boolean;
  multiplier: number;
  accelerationPercent: number;
  minViews: number;
};

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'La solicitud falló');
  }
  return data;
}

export function TrackingPanel() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<any>(null);
  const [selectedWindow, setSelectedWindow] = useState<'24h' | '7d' | '30d'>('7d');
  const [job, setJob] = useState<{ id: string; text: string; status?: string } | null>(null);

  const [ruleChannelId, setRuleChannelId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<AlertRule>({
    active: true,
    multiplier: 3,
    accelerationPercent: 100,
    minViews: 1000,
  });
  const [ruleSavedMsg, setRuleSavedMsg] = useState('');

  const load = () =>
    api('/api/tracking')
      .then(data => setChannels(data.channels))
      .catch(err => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!job?.id || job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const data = await api(`/api/jobs/${job.id}`);
        if (data.job) {
          setJob({
            id: data.job.id,
            status: data.job.status,
            text: `${data.job.id} (${data.job.status}${data.job.error ? ` · ${data.job.error}` : ''})`,
          });
          if (data.job.status === 'succeeded' || data.job.status === 'failed') {
            load();
          }
        }
      } catch {
        // ignore polling error
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);

  const loadHistory = async (targetChannelId: string, win: '24h' | '7d' | '30d' = selectedWindow) => {
    setError('');
    setSelectedWindow(win);
    try {
      const data = await api(`/api/tracking/${targetChannelId}/history?window=${win}`);
      setHistory(data.history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const openRuleEditor = async (targetChannelId: string) => {
    setError('');
    setRuleSavedMsg('');
    if (ruleChannelId === targetChannelId) {
      setRuleChannelId(null);
      return;
    }
    try {
      const data = await api(`/api/alert-rules/${targetChannelId}`);
      if (data.rule) {
        setRuleForm({
          active: Boolean(data.rule.active),
          multiplier: Number(data.rule.multiplier ?? 3),
          accelerationPercent: Number(data.rule.accelerationPercent ?? 100),
          minViews: Number(data.rule.minViews ?? 1000),
        });
      }
      setRuleChannelId(targetChannelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la regla');
    }
  };

  const saveRuleEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleChannelId) return;
    setError('');
    setRuleSavedMsg('');
    try {
      await api(`/api/alert-rules/${ruleChannelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ruleForm),
      });
      setRuleSavedMsg('Regla actualizada');
      setTimeout(() => setRuleSavedMsg(''), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la regla');
    }
  };

  const activeCount = channels.filter(c => c.active).length;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Telemetría de canales</div>
          <h2>
            Seguimiento <span className="count-badge">{channels.length}</span>
          </h2>
          <p className="lede">
            Guardar en el Swipe File no sigue el canal. Seguir conserva observaciones; dejar de seguir no las borra.
          </p>
        </div>
        {channels.length > 0 && (
          <div className="stat-pills">
            <span className="pill pill-emerald">{activeCount} activos</span>
            <span className="pill pill-muted">{channels.length - activeCount} pausados</span>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}

      <form
        className="inline-card"
        onSubmit={async event => {
          event.preventDefault();
          setError('');
          try {
            await api('/api/tracking', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ channelId: channelId.trim() }),
            });
            setChannelId('');
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Error');
          }
        }}
      >
        <label className="field">
          <span>ID de canal de YouTube (UC...)</span>
          <input
            aria-label="ID de canal a seguir"
            value={channelId}
            onChange={event => setChannelId(event.target.value)}
            placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
          />
        </label>
        <button className="btn primary" type="submit">
          + Seguir canal
        </button>
      </form>

      {job && (
        <div className="job-toast">
          <div>
            <span className="eyebrow">Trabajo en cola</span>
            <p className="meta">
              Trabajo: <span className="num">{job.text}</span>. La captura se procesa en segundo plano y no bloquea esta página.
            </p>
          </div>
          {(job.status === 'queued' || job.status === 'running') && (
            <button
              type="button"
              className="btn tiny danger"
              onClick={async () => {
                try {
                  await api(`/api/jobs/${job.id}/cancel`, { method: 'POST' });
                  setJob({ ...job, status: 'cancelled', text: `${job.id} (cancelled)` });
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'No se pudo cancelar');
                }
              }}
            >
              Cancelar captura
            </button>
          )}
        </div>
      )}

      <div className="tracked-grid">
        {channels.map(channel => (
          <article className="tracked-card" key={channel.channelId}>
            <div className="tracked-card-head">
              <div>
                <div className="tracked-title-row">
                  <strong>{channel.title}</strong>
                  <span className={channel.active ? 'pill pill-emerald' : 'pill pill-muted'}>
                    {channel.active ? 'Activo' : 'Pausado'}
                  </span>
                  <span className="pill pill-info">{channel.provider}</span>
                  <span className="pill pill-accent">Calidad: {channel.quality}</span>
                </div>
                <span className="meta num mono-tag">{channel.channelId}</span>
              </div>
              <a
                className="btn tiny subtle"
                href={`https://www.youtube.com/channel/${channel.channelId}`}
                target="_blank"
                rel="noreferrer"
              >
                YouTube ↗
              </a>
            </div>

            <div className="tracked-meta-grid">
              <div>
                <span className="meta-label">Próximo vencimiento</span>
                <strong className="num">{new Date(channel.nextDueAt).toLocaleString()}</strong>
              </div>
              <div>
                <span className="meta-label">Último éxito</span>
                <strong className="num">
                  {channel.lastSuccessAt ? new Date(channel.lastSuccessAt).toLocaleString() : 'Nunca'}
                </strong>
              </div>
              <div>
                <span className="meta-label">Intervalo</span>
                <strong className="num">Cada {channel.intervalHours} h</strong>
              </div>
            </div>

            {channel.lastError && (
              <p className="tracked-error">Último error: {channel.lastError}</p>
            )}

            <div className="toolbar tracked-actions">
              <button
                className="btn tiny primary"
                type="button"
                onClick={async () => {
                  setError('');
                  try {
                    const data = await api(`/api/tracking/${channel.channelId}/refresh`, {
                      method: 'POST',
                    });
                    setJob({
                      id: data.jobId,
                      status: data.status,
                      text: `${data.jobId} (${data.status}${data.created ? '' : ', ya en curso'})`,
                    });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Error');
                  }
                }}
              >
                Actualizar ahora
              </button>
              <button
                className={history?.channelId === channel.channelId ? 'btn tiny saved' : 'btn tiny'}
                type="button"
                onClick={() => loadHistory(channel.channelId)}
              >
                Ver historial
              </button>
              <button
                className={ruleChannelId === channel.channelId ? 'btn tiny saved' : 'btn tiny'}
                type="button"
                onClick={() => openRuleEditor(channel.channelId)}
              >
                Umbrales de alerta
              </button>
              <button
                className="btn tiny"
                type="button"
                onClick={async () => {
                  setError('');
                  try {
                    await api(`/api/tracking/${channel.channelId}`, { method: 'DELETE' });
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Error');
                  }
                }}
              >
                Dejar de seguir
              </button>
              <button
                className="btn tiny danger"
                type="button"
                onClick={async () => {
                  if (!confirm('Esto borra las observaciones de este canal.')) return;
                  setError('');
                  try {
                    await api(`/api/tracking/${channel.channelId}/history`, { method: 'DELETE' });
                    setHistory(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Error');
                  }
                }}
              >
                Borrar historial
              </button>
            </div>

            {ruleChannelId === channel.channelId && (
              <form className="rule-drawer" onSubmit={saveRuleEditor}>
                <div className="rule-drawer-head">
                  <strong>Reglas de alerta para {channel.title}</strong>
                  {ruleSavedMsg && <span className="pill pill-emerald">{ruleSavedMsg}</span>}
                </div>
                <div className="rule-grid">
                  <label className="field">
                    <span>Multiplicador Outlier (×)</span>
                    <input
                      type="number"
                      step="0.5"
                      min="1"
                      max="100"
                      className="num"
                      value={ruleForm.multiplier}
                      onChange={e => setRuleForm({ ...ruleForm, multiplier: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>Aceleración mínima (%)</span>
                    <input
                      type="number"
                      step="10"
                      min="0"
                      className="num"
                      value={ruleForm.accelerationPercent}
                      onChange={e =>
                        setRuleForm({ ...ruleForm, accelerationPercent: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Vistas mínimas</span>
                    <input
                      type="number"
                      step="100"
                      min="0"
                      className="num"
                      value={ruleForm.minViews}
                      onChange={e => setRuleForm({ ...ruleForm, minViews: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>Estado de alertas</span>
                    <select
                      value={ruleForm.active ? '1' : '0'}
                      onChange={e => setRuleForm({ ...ruleForm, active: e.target.value === '1' })}
                    >
                      <option value="1">Activas</option>
                      <option value="0">Silenciadas</option>
                    </select>
                  </label>
                </div>
                <div className="toolbar">
                  <button type="submit" className="btn tiny primary">
                    Guardar regla
                  </button>
                  <button
                    type="button"
                    className="btn tiny"
                    onClick={() => setRuleChannelId(null)}
                  >
                    Cerrar
                  </button>
                </div>
              </form>
            )}
          </article>
        ))}
      </div>

      {channels.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📡</div>
          <strong>Ningún canal en seguimiento</strong>
          <p className="meta">
            Sigue un canal desde la pestaña Explorar o introduce su ID <code>UC...</code> arriba para programar capturas periódicas.
          </p>
        </div>
      )}

      {history && (
        <div className="history-card">
          <div className="history-head">
            <div>
              <div className="eyebrow">Serie temporal y cobertura</div>
              <h3>
                Historial <span className="num mono-tag">{history.channelId}</span>
              </h3>
              <p className="lede">{history.note}</p>
            </div>
            <div className="segmented" role="group" aria-label="Ventana de historial">
              {(['24h', '7d', '30d'] as const).map(win => (
                <button
                  key={win}
                  type="button"
                  className={selectedWindow === win ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => loadHistory(history.channelId, win)}
                >
                  {win}
                </button>
              ))}
            </div>
          </div>

          <div className="window-cards">
            {([
              ['h24', 'Ventana 24 h'],
              ['d7', 'Ventana 7 días'],
              ['d30', 'Ventana 30 días'],
            ] as const).map(([key, label]) => {
              const window = history.windows[key] as WindowMetric;
              return (
                <div className="window-card" key={key}>
                  <div className="window-card-top">
                    <span className="meta-label">{label}</span>
                    <span className="pill pill-info">{window.quality}</span>
                  </div>
                  <div className="window-delta num">
                    {window.delta != null
                      ? `${window.delta >= 0 ? '+' : ''}${window.delta.toLocaleString()} vistas`
                      : '—'}
                  </div>
                  <p className="meta">{window.explanation}</p>
                </div>
              );
            })}
          </div>

          {history.windows.projection && (
            <div className="projection-banner">
              <strong>Proyección mensual (30d):</strong> {history.windows.projection.explanation}
            </div>
          )}

          {history.points.length === 0 ? (
            <p className="empty">Sin puntos de historial registrados todavía.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha de captura</th>
                    <th>Suscriptores</th>
                    <th>Vistas totales</th>
                    <th>Videos</th>
                    <th>Fuente</th>
                  </tr>
                </thead>
                <tbody>
                  {history.points.slice(0, 12).map((pt: any, idx: number) => (
                    <tr key={pt.observedAt ?? idx}>
                      <td className="num">
                        {pt.observedAt ? new Date(pt.observedAt).toLocaleString() : '—'}
                      </td>
                      <td className="num">
                        {pt.subscribers != null ? pt.subscribers.toLocaleString() : '—'}
                      </td>
                      <td className="num">
                        {pt.totalViews != null ? pt.totalViews.toLocaleString() : '—'}
                      </td>
                      <td className="num">{pt.videoCount ?? '—'}</td>
                      <td>
                        <span className="pill pill-muted">{pt.provider ?? 'innertube'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
