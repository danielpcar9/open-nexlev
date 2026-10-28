'use client';

import React, { useState, useEffect } from 'react';
import { AlertsPanel } from '../components/alerts-panel';
import { ResearchPanel } from '../components/research-panel';
import { TrackingPanel } from '../components/tracking-panel';
import { WorkerBanner } from '../components/worker-banner';

interface OutlierVideo {
  id: string;
  title: string;
  views: number;
  publishedText: string;
  outlierScore: number;
  viewsToSubsRatio: number;
  url: string;
  thumbnailUrl: string;
}

interface NicheChannelResult {
  channelId: string;
  title: string;
  handle: string;
  subscribers: number;
  medianViews: number;
  subscriberToViewRatio: number;
  estimatedMonthlyRevenueUsd: { low: number; high: number };
  topOutliers: OutlierVideo[];
  channelUrl: string;
}

const tabs = [
  ['explorer', 'Explorar'],
  ['swipe', 'Swipe File'],
  ['transcript', 'Guiones'],
  ['tracking', 'Seguimiento'],
  ['alerts', 'Alertas'],
  ['research', 'Investigación'],
] as const;

export default function OpenNexLevDashboard() {
  const [query, setQuery] = useState('medieval history');
  const [maxSubscribers, setMaxSubscribers] = useState(50000);
  const [minOutlierScore, setMinOutlierScore] = useState(3.0);
  const [minMedianViews, setMinMedianViews] = useState(5000);
  const [customRpm, setCustomRpm] = useState(5.5);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<NicheChannelResult[]>([]);
  const [swipeFile, setSwipeFile] = useState<NicheChannelResult[]>([]);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number][0]>('explorer');

  const [videoInput, setVideoInput] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptResult, setTranscriptResult] = useState<{
    title: string;
    wordCount: number;
    cleanText: string;
    segments: { timestamp: string; text: string }[];
  } | null>(null);

  const [swipeReady, setSwipeReady] = useState(false);
  const [savingSwipe, setSavingSwipe] = useState(false);
  async function swipeRequest(body?: unknown) {
    const response = await fetch('/api/swipe', body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar el canal');
    return data.channels as NicheChannelResult[];
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let saved = await swipeRequest();
      try {
        const legacy = localStorage.getItem('open_nexlev_swipe_file');
        if (legacy) {
          saved = await swipeRequest({ action: 'import', channels: JSON.parse(legacy) });
          localStorage.removeItem('open_nexlev_swipe_file');
        }
      } catch {
        if (!cancelled) setError('SQLite está disponible, pero no se pudieron importar los guardados antiguos. Se conservaron en el navegador.');
      }
      if (!cancelled) { setSwipeFile(saved); setSwipeReady(true); }
    })().catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error cargando el Swipe File'); });
    return () => { cancelled = true; }
  }, []);

  const toggleSwipeChannel = async (ch: NicheChannelResult) => {
    if (!swipeReady || savingSwipe) return;
    setSavingSwipe(true); setError('');
    try {
      const exists = swipeFile.some(item => item.channelId === ch.channelId);
      setSwipeFile(await swipeRequest(exists ? { action: 'remove', channelId: ch.channelId } : { action: 'save', channel: ch }));
    } catch (err) { setError(err instanceof Error ? err.message : 'Error guardando el canal'); }
    finally { setSavingSwipe(false); }
  };

  const handleSearchNiches = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          maxSubscribers,
          minOutlierScore,
          minMedianViews,
          maxChannelsToAnalyze: 12,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'La solicitud falló');
      if (data.ok) {
        setChannels(data.channels);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleExtractTranscript = async (targetUrlOrId?: string) => {
    const target = targetUrlOrId || videoInput;
    if (!target) return;
    setActiveTab('transcript');
    setVideoInput(target);
    setError('');
    setTranscriptLoading(true);
    setTranscriptResult(null);
    try {
      const res = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIdOrUrl: target }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'La solicitud falló');
      if (data.ok) {
        setTranscriptResult(data.transcript);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setTranscriptLoading(false);
    }
  };

  const displayedList = activeTab === 'swipe' ? swipeFile : channels;
  const counts: Partial<Record<(typeof tabs)[number][0], number>> = {
    explorer: channels.length,
    swipe: swipeFile.length,
  };

  return (
    <div className="app">
      <aside className="side">
        <div className="mark">
          <div className="mark-seal">ON</div>
          <div>
            <h1>Open-NexLev</h1>
            <p>Nichos y outliers</p>
          </div>
        </div>
        <nav className="nav" aria-label="Secciones">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" aria-current={activeTab === id ? 'page' : undefined} onClick={() => setActiveTab(id)}>
              {label}
              {counts[id] != null && <span className="count">{counts[id]}</span>}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        <WorkerBanner />
        {error && <p role="alert" className="alert">{error}</p>}
        {activeTab === 'tracking' ? <TrackingPanel /> : activeTab === 'alerts' ? <AlertsPanel /> : activeTab === 'research' ? <ResearchPanel /> : activeTab === 'transcript' ? (
          <section className="panel">
            <h2>Guion limpio</h2>
            <p className="lede">Pega una URL o un ID. El texto sale sin marcas de tiempo para poder leerlo o copiarlo.</p>
            <form className="inline" onSubmit={event => { event.preventDefault(); handleExtractTranscript(); }}>
              <label className="field">
                <span>Video</span>
                <input value={videoInput} onChange={event => setVideoInput(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
              </label>
              <button className="btn primary" type="submit" disabled={transcriptLoading}>
                {transcriptLoading ? 'Extrayendo…' : 'Extraer guion'}
              </button>
            </form>
            {transcriptResult && (
              <div className="stack below">
                <div className="channel-head">
                  <div>
                    <strong>{transcriptResult.title}</strong>
                    <p className="meta"><span className="num">{transcriptResult.wordCount.toLocaleString()}</span> palabras</p>
                  </div>
                  <button className="btn" type="button" onClick={() => navigator.clipboard.writeText(transcriptResult.cleanText).catch(() => setError('No se pudo copiar. Selecciona el texto y cópialo manualmente.'))}>
                    Copiar guion
                  </button>
                </div>
                <textarea className="script" readOnly value={transcriptResult.cleanText} rows={14} />
              </div>
            )}
          </section>
        ) : (
          <>
            <form className="filters" onSubmit={handleSearchNiches}>
              <label className="field">
                <span>Semilla del nicho</span>
                <input value={query} onChange={event => setQuery(event.target.value)} />
              </label>
              <label className="field">
                <span>Máximo de suscriptores</span>
                <input className="num" type="number" value={maxSubscribers} onChange={event => setMaxSubscribers(Number(event.target.value))} />
              </label>
              <label className="field">
                <span>Outlier mínimo</span>
                <input className="num" type="number" step="0.5" value={minOutlierScore} onChange={event => setMinOutlierScore(Number(event.target.value))} />
              </label>
              <label className="field">
                <span>Mediana mínima de vistas</span>
                <input className="num" type="number" value={minMedianViews} onChange={event => setMinMedianViews(Number(event.target.value))} />
              </label>
              <label className="field">
                <span>RPM supuesto, USD</span>
                <input className="num" type="number" step="0.5" value={customRpm} onChange={event => setCustomRpm(Number(event.target.value))} />
              </label>
              <button className="btn primary" type="submit" disabled={loading}>
                {loading ? 'Buscando…' : 'Buscar nichos'}
              </button>
            </form>

            <div className="list">
              {displayedList.length === 0 && (
                <p className="empty">
                  {activeTab === 'swipe'
                    ? 'El Swipe File está vacío. Guardar un canal no lo pone en seguimiento.'
                    : 'Todavía no hay canales. La búsqueda consulta YouTube y no rellena esta lista con cifras de ejemplo.'}
                </p>
              )}
              {displayedList.map(ch => {
                const monthlyRevenue = Math.round(((ch.medianViews * 8) / 1000) * customRpm);
                const isSaved = swipeFile.some(item => item.channelId === ch.channelId);
                return (
                  <article className="channel" key={ch.channelId}>
                    <div className="channel-head">
                      <div>
                        <h2>
                          <a href={ch.channelUrl} target="_blank" rel="noreferrer">
                            {ch.title} <span>{ch.handle}</span>
                          </a>
                        </h2>
                        <dl className="metrics">
                          <div><dt>Suscriptores</dt><dd className="num">{ch.subscribers.toLocaleString()}</dd></div>
                          <div><dt>Mediana de vistas</dt><dd className="num">{ch.medianViews.toLocaleString()}</dd></div>
                          <div><dt>Vistas / subs</dt><dd className="num">{ch.subscriberToViewRatio}×</dd></div>
                          <div>
                            <dt>Escenario por publicación</dt>
                            <dd className="num">${monthlyRevenue.toLocaleString()}/mes</dd>
                            <dd className="assumption">Mediana × 8 × RPM supuesto / 1000. No es un ingreso observado.</dd>
                          </div>
                        </dl>
                      </div>
                      <div className="actions">
                        <button className={isSaved ? 'btn saved' : 'btn'} type="button" disabled={!swipeReady || savingSwipe} onClick={() => toggleSwipeChannel(ch)}>
                          {isSaved ? 'En el Swipe File' : 'Guardar'}
                        </button>
                        <button className="btn" type="button" onClick={async () => {
                          setError('');
                          try {
                            const response = await fetch('/api/tracking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: ch.channelId, title: ch.title }) });
                            const data = await response.json();
                            if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo seguir el canal');
                            setActiveTab('tracking');
                          } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo seguir el canal'); }
                        }}>Seguir canal</button>
                      </div>
                    </div>
                    <div className="videos">
                      {ch.topOutliers.slice(0, 4).map(video => (
                        <article className="video" key={video.id}>
                          <div className="shot">
                            <img src={video.thumbnailUrl} alt="" />
                            <span className={video.outlierScore >= 5 ? 'badge hot' : 'badge'}>{video.outlierScore}×</span>
                          </div>
                          <div className="video-body">
                            <a href={video.url} target="_blank" rel="noreferrer">{video.title}</a>
                            <div className="video-meta">
                              <span className="num">{video.views.toLocaleString()} · {video.publishedText}</span>
                              <button className="btn tiny" type="button" onClick={() => handleExtractTranscript(video.id)}>Guion</button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
