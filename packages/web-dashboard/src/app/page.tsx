'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  ['explorer', 'Explorar', 'Descubrimiento de nichos y outliers en vivo'],
  ['swipe', 'Swipe File', 'Biblioteca persistente de canales referentes'],
  ['transcript', 'Guiones', 'Extractor limpio y con marcas de tiempo (JSON3)'],
  ['tracking', 'Seguimiento', 'Capturas periódicas y ventanas de crecimiento'],
  ['alerts', 'Alertas', 'Señales de nuevos outliers y aceleración'],
  ['research', 'Investigación', 'Score v1 de mercado, competencia y patrones'],
] as const;

const seedPresets = [
  'medieval history',
  'stoic philosophy',
  'space documentaries',
  'ancient civilizations',
  'true crime stories',
  'personal finance explained',
];

type SortMode = 'outlier' | 'ratio' | 'median' | 'subs_asc';

export default function OpenNexLevDashboard() {
  const [query, setQuery] = useState('medieval history');
  const [maxSubscribers, setMaxSubscribers] = useState(50000);
  const [minOutlierScore, setMinOutlierScore] = useState(3.0);
  const [minMedianViews, setMinMedianViews] = useState(5000);
  const [customRpm, setCustomRpm] = useState(5.5);
  const [maxChannelsToAnalyze, setMaxChannelsToAnalyze] = useState(12);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<NicheChannelResult[]>([]);
  const [swipeFile, setSwipeFile] = useState<NicheChannelResult[]>([]);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number][0]>('explorer');

  const [filterText, setFilterText] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('outlier');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const [videoInput, setVideoInput] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptMode, setTranscriptMode] = useState<'clean' | 'segments'>('clean');
  const [segmentQuery, setSegmentQuery] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [transcriptResult, setTranscriptResult] = useState<{
    title: string;
    wordCount: number;
    cleanText: string;
    segments: { timestamp: string; text: string }[];
  } | null>(null);

  const [swipeReady, setSwipeReady] = useState(false);
  const [savingSwipe, setSavingSwipe] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  async function swipeRequest(body?: unknown) {
    const response = await fetch(
      '/api/swipe',
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : { cache: 'no-store' }
    );
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
        if (!cancelled) {
          setError(
            'SQLite está disponible, pero no se pudieron importar los guardados antiguos. Se conservaron en el navegador.'
          );
        }
      }
      if (!cancelled) {
        setSwipeFile(saved);
        setSwipeReady(true);
      }
    })().catch(err => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Error cargando el Swipe File');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSwipeChannel = async (ch: NicheChannelResult) => {
    if (!swipeReady || savingSwipe) return;
    setSavingSwipe(true);
    setError('');
    try {
      const exists = swipeFile.some(item => item.channelId === ch.channelId);
      setSwipeFile(
        await swipeRequest(
          exists
            ? { action: 'remove', channelId: ch.channelId }
            : { action: 'save', channel: ch }
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando el canal');
    } finally {
      setSavingSwipe(false);
    }
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
          maxChannelsToAnalyze,
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

  const rawList = activeTab === 'swipe' ? swipeFile : channels;

  const displayedList = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    const filtered = q
      ? rawList.filter(
          ch =>
            ch.title.toLowerCase().includes(q) ||
            ch.handle.toLowerCase().includes(q) ||
            ch.topOutliers.some(v => v.title.toLowerCase().includes(q))
        )
      : [...rawList];

    return filtered.sort((a, b) => {
      if (sortMode === 'outlier') {
        const maxA = Math.max(0, ...a.topOutliers.map(v => v.outlierScore));
        const maxB = Math.max(0, ...b.topOutliers.map(v => v.outlierScore));
        return maxB - maxA;
      }
      if (sortMode === 'ratio') return b.subscriberToViewRatio - a.subscriberToViewRatio;
      if (sortMode === 'median') return b.medianViews - a.medianViews;
      return a.subscribers - b.subscribers;
    });
  }, [rawList, filterText, sortMode]);

  const summaryStats = useMemo(() => {
    if (displayedList.length === 0) return null;
    const avgMedian = Math.round(
      displayedList.reduce((acc, ch) => acc + ch.medianViews, 0) / displayedList.length
    );
    const bestOutlier = Math.max(
      0,
      ...displayedList.flatMap(ch => ch.topOutliers.map(v => v.outlierScore))
    );
    const avgMonthlyScenario = Math.round(
      displayedList.reduce(
        (acc, ch) => acc + ((ch.medianViews * 8) / 1000) * customRpm,
        0
      ) / displayedList.length
    );
    return {
      count: displayedList.length,
      avgMedian,
      bestOutlier,
      avgMonthlyScenario,
    };
  }, [displayedList, customRpm]);

  const counts: Partial<Record<(typeof tabs)[number][0], number>> = {
    explorer: channels.length,
    swipe: swipeFile.length,
  };

  const currentTabMeta = tabs.find(t => t[0] === activeTab) ?? tabs[0];

  const copyScriptText = (withTimestamps: boolean) => {
    if (!transcriptResult) return;
    const text = withTimestamps
      ? transcriptResult.segments.map(s => `[${s.timestamp}] ${s.text}`).join('\n')
      : transcriptResult.cleanText;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopyFeedback(withTimestamps ? '¡Timestamps copiados!' : '¡Guion copiado!');
        setTimeout(() => setCopyFeedback(''), 2200);
      })
      .catch(() =>
        setError('No se pudo copiar. Selecciona el texto y cópialo manualmente.')
      );
  };

  const downloadScriptTxt = () => {
    if (!transcriptResult) return;
    const blob = new Blob([transcriptResult.cleanText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${transcriptResult.title.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 50) || 'guion'}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredSegments = useMemo(() => {
    if (!transcriptResult) return [];
    const q = segmentQuery.trim().toLowerCase();
    if (!q) return transcriptResult.segments;
    return transcriptResult.segments.filter(
      s => s.text.toLowerCase().includes(q) || s.timestamp.toLowerCase().includes(q)
    );
  }, [transcriptResult, segmentQuery]);

  return (
    <div className="app">
      <aside className="side">
        <div className="mark">
          <div className="mark-seal">ON</div>
          <div className="mark-copy">
            <div className="mark-title-row">
              <h1>Open-NexLev</h1>
              <span className="version-pill">STUDIO</span>
            </div>
            <p>Nichos y outliers</p>
          </div>
        </div>

        <div className="nav-group">
          <div className="nav-group-label">Plataforma</div>
          <nav className="nav" aria-label="Secciones">
            {tabs.map(([id, label], index) => (
              <button
                key={id}
                type="button"
                aria-current={activeTab === id ? 'page' : undefined}
                onClick={() => setActiveTab(id)}
              >
                <span className="nav-label-wrap">
                  <span className="nav-index num">0{index + 1}</span>
                  <span>{label}</span>
                </span>
                {counts[id] != null && <span className="count">{counts[id]}</span>}
              </button>
            ))}
          </nav>
        </div>

        <div className="side-footer">
          <div className="side-card">
            <div className="side-card-row">
              <span className="meta-label">Modo visual</span>
              <button
                type="button"
                className="theme-toggle"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? '🌙 Oscuro' : '☀️ Claro'}
              </button>
            </div>
            <div className="side-card-row">
              <span className="meta-label">Motor</span>
              <span className="num mono-tag">Innertube + SQLite</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">Open-NexLev · Inteligencia de Creadores</div>
            <h2 className="topbar-title">{currentTabMeta[1]}</h2>
            <p className="topbar-sub">{currentTabMeta[2]}</p>
          </div>
          <div className="topbar-pills">
            <div className="kpi-chip">
              <span>En explorador</span>
              <strong className="num">{channels.length}</strong>
            </div>
            <div className="kpi-chip">
              <span>Swipe File</span>
              <strong className="num">{swipeFile.length}</strong>
            </div>
            <div className="kpi-chip">
              <span>RPM base</span>
              <strong className="num">${customRpm}</strong>
            </div>
          </div>
        </header>

        <WorkerBanner />

        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}

        {activeTab === 'tracking' ? (
          <TrackingPanel />
        ) : activeTab === 'alerts' ? (
          <AlertsPanel />
        ) : activeTab === 'research' ? (
          <ResearchPanel />
        ) : activeTab === 'transcript' ? (
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Estudio de transcripciones JSON3</div>
                <h2>Guion limpio</h2>
                <p className="lede">
                  Pega una URL o un ID de YouTube. El texto sale sin marcas de tiempo para leerlo o copiarlo, o en vista interactiva por segmentos.
                </p>
              </div>
            </div>

            <form
              className="inline-card"
              onSubmit={event => {
                event.preventDefault();
                handleExtractTranscript();
              }}
            >
              <label className="field">
                <span>Video de YouTube (URL o ID de 11 caracteres)</span>
                <input
                  value={videoInput}
                  onChange={event => setVideoInput(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                />
              </label>
              <button className="btn primary" type="submit" disabled={transcriptLoading}>
                {transcriptLoading ? 'Extrayendo…' : 'Extraer guion'}
              </button>
            </form>

            {transcriptResult && (
              <div className="script-studio below">
                <div className="script-header">
                  <div>
                    <div className="eyebrow">Transcripción verificada</div>
                    <strong className="script-title">{transcriptResult.title}</strong>
                    <div className="script-stats">
                      <span className="pill pill-accent num">
                        {transcriptResult.wordCount.toLocaleString()} palabras
                      </span>
                      <span className="pill pill-info num">
                        ~{Math.max(1, Math.round(transcriptResult.wordCount / 150))} min locución
                      </span>
                      <span className="pill pill-muted num">
                        {transcriptResult.segments.length} segmentos
                      </span>
                      {copyFeedback && (
                        <span className="pill pill-emerald">{copyFeedback}</span>
                      )}
                    </div>
                  </div>

                  <div className="toolbar">
                    <div className="segmented" role="group" aria-label="Formato de guion">
                      <button
                        type="button"
                        className={transcriptMode === 'clean' ? 'seg-btn active' : 'seg-btn'}
                        onClick={() => setTranscriptMode('clean')}
                      >
                        Texto continuo
                      </button>
                      <button
                        type="button"
                        className={transcriptMode === 'segments' ? 'seg-btn active' : 'seg-btn'}
                        onClick={() => setTranscriptMode('segments')}
                      >
                        Con timestamps
                      </button>
                    </div>
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => copyScriptText(false)}
                    >
                      Copiar guion
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => copyScriptText(true)}
                    >
                      Copiar con timestamps
                    </button>
                    <button className="btn subtle" type="button" onClick={downloadScriptTxt}>
                      Descargar .txt
                    </button>
                  </div>
                </div>

                {transcriptMode === 'clean' ? (
                  <textarea
                    className="script"
                    readOnly
                    value={transcriptResult.cleanText}
                    rows={16}
                  />
                ) : (
                  <div className="segments-box">
                    <div className="segments-search">
                      <input
                        placeholder="Filtrar frases o marca de tiempo en el guion…"
                        value={segmentQuery}
                        onChange={e => setSegmentQuery(e.target.value)}
                      />
                    </div>
                    <div className="segments-list">
                      {filteredSegments.map((seg, i) => (
                        <div className="segment-row" key={`${seg.timestamp}-${i}`}>
                          <span className="segment-time num">{seg.timestamp}</span>
                          <span className="segment-text">{seg.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        ) : (
          <>
            {activeTab === 'explorer' && (
              <div className="preset-bar">
                <span className="meta-label">Semillas rápidas:</span>
                <div className="filter-pills">
                  {seedPresets.map(preset => (
                    <button
                      key={preset}
                      type="button"
                      className={query === preset ? 'chip active' : 'chip'}
                      onClick={() => setQuery(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form className="filters" onSubmit={handleSearchNiches}>
              <label className="field field-seed">
                <span>Semilla del nicho</span>
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Ej. medieval history, stoicism, space..."
                />
              </label>
              <label className="field">
                <span>Máximo de suscriptores</span>
                <input
                  className="num"
                  type="number"
                  value={maxSubscribers}
                  onChange={event => setMaxSubscribers(Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>Outlier mínimo (×)</span>
                <input
                  className="num"
                  type="number"
                  step="0.5"
                  value={minOutlierScore}
                  onChange={event => setMinOutlierScore(Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>Mediana mínima de vistas</span>
                <input
                  className="num"
                  type="number"
                  value={minMedianViews}
                  onChange={event => setMinMedianViews(Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>RPM supuesto, USD</span>
                <input
                  className="num"
                  type="number"
                  step="0.5"
                  value={customRpm}
                  onChange={event => setCustomRpm(Number(event.target.value))}
                />
              </label>
              <div className="filter-submit-wrap">
                <label className="field field-compact">
                  <span>Muestra</span>
                  <select
                    aria-label="Canales a analizar"
                    className="num"
                    value={maxChannelsToAnalyze}
                    onChange={e => setMaxChannelsToAnalyze(Number(e.target.value))}
                  >
                    <option value={8}>8 canales</option>
                    <option value={12}>12 canales</option>
                    <option value={16}>16 canales</option>
                    <option value={20}>20 canales</option>
                  </select>
                </label>
                <button className="btn primary btn-search" type="submit" disabled={loading}>
                  {loading ? 'Buscando…' : 'Buscar nichos'}
                </button>
              </div>
            </form>

            {summaryStats && (
              <div className="kpi-grid">
                <div className="kpi-card">
                  <span className="meta-label">Canales detectados</span>
                  <strong className="kpi-value num">{summaryStats.count}</strong>
                  <span className="meta">Filtrados por tus umbrales</span>
                </div>
                <div className="kpi-card">
                  <span className="meta-label">Mediana promedio</span>
                  <strong className="kpi-value num">
                    {summaryStats.avgMedian.toLocaleString()}
                  </strong>
                  <span className="meta">Vistas por video (muestra 25)</span>
                </div>
                <div className="kpi-card">
                  <span className="meta-label">Mejor Outlier</span>
                  <strong className="kpi-value num accent-text">
                    {summaryStats.bestOutlier.toFixed(1)}×
                  </strong>
                  <span className="meta">Sobre la mediana de su canal</span>
                </div>
                <div className="kpi-card">
                  <span className="meta-label">Escenario mensual medio</span>
                  <strong className="kpi-value num emerald-text">
                    ${summaryStats.avgMonthlyScenario.toLocaleString()}/mes
                  </strong>
                  <span className="meta">8 videos/mes a ${customRpm} RPM</span>
                </div>
              </div>
            )}

            {rawList.length > 0 && (
              <div className="results-bar">
                <input
                  className="results-search"
                  placeholder="Filtrar canales o videos en pantalla…"
                  value={filterText}
                  onChange={e => setFilterText(e.target.value)}
                />
                <div className="results-sort">
                  <span className="meta-label">Ordenar por:</span>
                  <select
                    aria-label="Ordenar canales"
                    value={sortMode}
                    onChange={e => setSortMode(e.target.value as SortMode)}
                  >
                    <option value="outlier">Mayor Outlier (×)</option>
                    <option value="ratio">Mayor Ratio Vistas / Subs</option>
                    <option value="median">Mayor Mediana de vistas</option>
                    <option value="subs_asc">Menos Suscriptores</option>
                  </select>
                </div>
              </div>
            )}

            <div className="list">
              {displayedList.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon">
                    {activeTab === 'swipe' ? '🗂️' : '✨'}
                  </div>
                  <strong>
                    {activeTab === 'swipe'
                      ? 'Tu Swipe File está vacío'
                      : 'Listo para descubrir nichos y outliers'}
                  </strong>
                  <p className="empty">
                    {activeTab === 'swipe'
                      ? 'El Swipe File está vacío. Guardar un canal no lo pone en seguimiento.'
                      : 'Todavía no hay canales. La búsqueda consulta YouTube y no rellena esta lista con cifras de ejemplo.'}
                  </p>
                </div>
              )}

              {displayedList.map(ch => {
                const monthlyRevenue = Math.round(((ch.medianViews * 8) / 1000) * customRpm);
                const isSaved = swipeFile.some(item => item.channelId === ch.channelId);
                const bestChannelOutlier = Math.max(
                  0,
                  ...ch.topOutliers.map(v => v.outlierScore)
                );
                const initials = ch.title
                  .split(/\s+/)
                  .slice(0, 2)
                  .map(w => w[0])
                  .join('')
                  .toUpperCase();

                return (
                  <article className="channel" key={ch.channelId}>
                    <div className="channel-head">
                      <div className="channel-identity">
                        <div className="channel-avatar" aria-hidden="true">
                          {initials || 'YT'}
                        </div>
                        <div>
                          <div className="channel-title-row">
                            <h2>
                              <a href={ch.channelUrl} target="_blank" rel="noreferrer">
                                {ch.title} <span>{ch.handle}</span>
                              </a>
                            </h2>
                            {bestChannelOutlier >= 5 && (
                              <span className="pill pill-hot num">
                                🔥 Pico {bestChannelOutlier}×
                              </span>
                            )}
                            {ch.subscribers <= 15000 && (
                              <span className="pill pill-emerald">Micro-Nicho</span>
                            )}
                          </div>
                          <span className="meta num mono-tag">{ch.channelId}</span>
                        </div>
                      </div>

                      <div className="actions">
                        <button
                          className={isSaved ? 'btn saved' : 'btn'}
                          type="button"
                          disabled={!swipeReady || savingSwipe}
                          onClick={() => toggleSwipeChannel(ch)}
                        >
                          {isSaved ? '★ En el Swipe File' : '☆ Guardar'}
                        </button>
                        <button
                          className="btn subtle"
                          type="button"
                          onClick={async () => {
                            setError('');
                            try {
                              const response = await fetch('/api/tracking', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  channelId: ch.channelId,
                                  title: ch.title,
                                }),
                              });
                              const data = await response.json();
                              if (!response.ok || !data.ok) {
                                throw new Error(data.error || 'No se pudo seguir el canal');
                              }
                              setActiveTab('tracking');
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : 'No se pudo seguir el canal'
                              );
                            }
                          }}
                        >
                          📡 Seguir canal
                        </button>
                      </div>
                    </div>

                    <dl className="metrics">
                      <div className="metric-box">
                        <dt>Suscriptores</dt>
                        <dd className="num">{ch.subscribers.toLocaleString()}</dd>
                      </div>
                      <div className="metric-box">
                        <dt>Mediana de vistas</dt>
                        <dd className="num">{ch.medianViews.toLocaleString()}</dd>
                      </div>
                      <div className="metric-box">
                        <dt>Vistas / subs</dt>
                        <dd className="num accent-text">{ch.subscriberToViewRatio}×</dd>
                      </div>
                      <div className="metric-box metric-revenue">
                        <dt>Escenario por publicación</dt>
                        <dd className="num emerald-text">
                          ${monthlyRevenue.toLocaleString()}/mes
                        </dd>
                        <dd className="assumption">
                          Mediana × 8 × RPM supuesto / 1000. No es un ingreso observado.
                        </dd>
                      </div>
                    </dl>

                    <div className="videos-header">
                      <span className="meta-label">
                        Videos Outlier destacados ({ch.topOutliers.slice(0, 4).length})
                      </span>
                    </div>

                    <div className="videos">
                      {ch.topOutliers.slice(0, 4).map(video => (
                        <article className="video" key={video.id}>
                          <div className="shot">
                            <img src={video.thumbnailUrl} alt="" loading="lazy" />
                            <span
                              className={
                                video.outlierScore >= 5
                                  ? 'badge hot'
                                  : video.outlierScore >= 3
                                    ? 'badge strong'
                                    : 'badge'
                              }
                            >
                              {video.outlierScore >= 5 ? '🔥 ' : '⚡ '}
                              {video.outlierScore}×
                            </span>
                            <span className="badge-ratio num">
                              {video.viewsToSubsRatio}× subs
                            </span>
                          </div>
                          <div className="video-body">
                            <a href={video.url} target="_blank" rel="noreferrer">
                              {video.title}
                            </a>
                            <div className="video-meta">
                              <span className="num">
                                {video.views.toLocaleString()} vistas · {video.publishedText}
                              </span>
                              <button
                                className="btn tiny primary"
                                type="button"
                                onClick={() => handleExtractTranscript(video.id)}
                              >
                                Guion
                              </button>
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
