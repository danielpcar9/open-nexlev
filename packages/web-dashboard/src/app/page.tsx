'use client';

import React, { useState, useEffect } from 'react';

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
  const [activeTab, setActiveTab] = useState<'explorer' | 'swipe' | 'transcript'>('explorer');

  // Estado para el modal/pestaña de extractor de guiones
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
    return () => { cancelled = true; };
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

  return (
    <div style={{ minHeight: '100vh', background: '#090d16', color: '#f8fafc', fontFamily: 'system-ui, sans-serif', padding: '32px' }}>
      <header style={{ maxWidth: '1280px', margin: '0 auto 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 800, margin: 0, background: 'linear-gradient(90deg, #a855f7, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            ⚡ Open-NexLev — Niche Finder & Outlier Explorer
          </h1>
          <p style={{ color: '#94a3b8', margin: '6px 0 0', fontSize: '14px' }}>
            Motor 100% Open Source con Innertube (Sin cuotas de YouTube Data API v3)
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setActiveTab('explorer')}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid #334155',
              background: activeTab === 'explorer' ? '#7c3aed' : '#1e293b',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🔍 Niche Finder ({channels.length})
          </button>
          <button
            onClick={() => setActiveTab('swipe')}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid #334155',
              background: activeTab === 'swipe' ? '#7c3aed' : '#1e293b',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            📌 Swipe File ({swipeFile.length})
          </button>
          <button
            onClick={() => setActiveTab('transcript')}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid #334155',
              background: activeTab === 'transcript' ? '#7c3aed' : '#1e293b',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            📜 Extractor de Guiones
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '1280px', margin: '0 auto' }}>
        {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
        {activeTab === 'transcript' ? (
          <section style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '24px' }}>
            <h2 style={{ marginTop: 0, fontSize: '20px' }}>Extractor de Guiones Limpios en 1 Clic</h2>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              <input
                value={videoInput}
                onChange={(e) => setVideoInput(e.target.value)}
                placeholder="Pega la URL de YouTube o ID del video (ej. https://www.youtube.com/watch?v=...)"
                style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #374151', background: '#030712', color: '#fff' }}
              />
              <button
                onClick={() => handleExtractTranscript()}
                disabled={transcriptLoading}
                style={{ padding: '12px 24px', borderRadius: '8px', background: '#7c3aed', color: '#fff', fontWeight: 700, border: 'none', cursor: 'pointer' }}
              >
                {transcriptLoading ? '⏳ Extrayendo...' : 'Extraer Guion'}
              </button>
            </div>

            {transcriptResult && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <strong>{transcriptResult.title}</strong>
                    <span style={{ marginLeft: '12px', color: '#a855f7', fontSize: '13px' }}>
                      {transcriptResult.wordCount.toLocaleString()} palabras
                    </span>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(transcriptResult.cleanText).catch(() => setError('No se pudo copiar. Selecciona el texto y cópialo manualmente.'))}
                    style={{ padding: '8px 14px', borderRadius: '6px', background: '#16a34a', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}
                  >
                    📋 Copiar Guion al Portapapeles
                  </button>
                </div>
                <textarea
                  readOnly
                  value={transcriptResult.cleanText}
                  rows={14}
                  style={{ width: '100%', padding: '14px', borderRadius: '8px', background: '#030712', color: '#e2e8f0', border: '1px solid #374151', lineHeight: 1.6 }}
                />
              </div>
            )}
          </section>
        ) : (
          <>
            {/* Barra de Filtros estilo NexLev + Calculadora de RPM */}
            <form
              onSubmit={handleSearchNiches}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '14px',
                background: '#111827',
                border: '1px solid #1f2937',
                padding: '20px',
                borderRadius: '12px',
                marginBottom: '24px',
                alignItems: 'end',
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
                  Keyword / Semilla del Nicho
                </label>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #374151', background: '#030712', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
                  Máx. Suscriptores ({maxSubscribers.toLocaleString()})
                </label>
                <input
                  type="number"
                  value={maxSubscribers}
                  onChange={(e) => setMaxSubscribers(Number(e.target.value))}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #374151', background: '#030712', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
                  Mín. Outlier Score ({minOutlierScore}x)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={minOutlierScore}
                  onChange={(e) => setMinOutlierScore(Number(e.target.value))}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #374151', background: '#030712', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
                  Mín. Mediana de Vistas ({minMedianViews.toLocaleString()})
                </label>
                <input
                  type="number"
                  value={minMedianViews}
                  onChange={(e) => setMinMedianViews(Number(e.target.value))}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #374151', background: '#030712', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
                  RPM Estimado del Nicho ($ USD)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={customRpm}
                  onChange={(e) => setCustomRpm(Number(e.target.value))}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #374151', background: '#030712', color: '#4ade80', fontWeight: 700 }}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: '11px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #7c3aed, #db2777)',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {loading ? '⏳ Escaneando YouTube...' : '🚀 Buscar Minas de Oro'}
              </button>
            </form>

            {/* Tabla Interactiva de Canales y Videos Outliers */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {displayedList.map((ch) => {
                const monthlyRevenue = Math.round(((ch.medianViews * 8) / 1000) * customRpm);
                const isSaved = swipeFile.some((s) => s.channelId === ch.channelId);

                return (
                  <div
                    key={ch.channelId}
                    style={{
                      background: '#111827',
                      border: '1px solid #1f2937',
                      borderRadius: '12px',
                      padding: '20px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                      <div>
                        <a
                          href={ch.channelUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', textDecoration: 'none' }}
                        >
                          {ch.title} <span style={{ color: '#94a3b8', fontSize: '14px' }}>{ch.handle}</span>
                        </a>
                        <div style={{ display: 'flex', gap: '18px', marginTop: '6px', fontSize: '13px', color: '#cbd5e1' }}>
                          <span>👥 <strong>{ch.subscribers.toLocaleString()}</strong> subs</span>
                          <span>📊 Mediana: <strong>{ch.medianViews.toLocaleString()}</strong> vistas</span>
                          <span>🚀 Ratio Vistas/Subs: <strong style={{ color: '#c084fc' }}>{ch.subscriberToViewRatio}x</strong></span>
                          <span>💰 Ingreso Est. (8 vids/mes): <strong style={{ color: '#4ade80' }}>${monthlyRevenue.toLocaleString()}/mes</strong></span>
                        </div>
                      </div>

                      <button
                        disabled={!swipeReady || savingSwipe}
                        onClick={() => toggleSwipeChannel(ch)}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '8px',
                          border: '1px solid #475569',
                          background: isSaved ? '#ca8a04' : '#1e293b',
                          color: '#fff',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {isSaved ? '★ Guardado en Swipe File' : '☆ Guardar en Swipe File'}
                      </button>
                    </div>

                    {/* Grid de Videos Outliers del Canal */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
                      {ch.topOutliers.slice(0, 4).map((v) => (
                        <div
                          key={v.id}
                          style={{
                            background: '#030712',
                            border: '1px solid #1e293b',
                            borderRadius: '10px',
                            overflow: 'hidden',
                          }}
                        >
                          <div style={{ position: 'relative' }}>
                            <img
                              src={v.thumbnailUrl}
                              alt={v.title}
                              style={{ width: '100%', height: '145px', objectFit: 'cover', display: 'block' }}
                            />
                            <span
                              style={{
                                position: 'absolute',
                                top: '8px',
                                left: '8px',
                                background: v.outlierScore >= 5 ? 'linear-gradient(135deg, #7c3aed, #db2777)' : '#16a34a',
                                padding: '4px 8px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 800,
                              }}
                            >
                              {v.outlierScore >= 5 ? '🔥' : '⚡'} {v.outlierScore}x Outlier
                            </span>
                          </div>
                          <div style={{ padding: '12px' }}>
                            <a
                              href={v.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9', textDecoration: 'none', display: 'block', marginBottom: '6px' }}
                            >
                              {v.title}
                            </a>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#94a3b8' }}>
                              <span>{v.views.toLocaleString()} vistas • {v.publishedText}</span>
                              <button
                                onClick={() => handleExtractTranscript(v.id)}
                                style={{
                                  background: '#1e293b',
                                  color: '#c084fc',
                                  border: '1px solid #334155',
                                  borderRadius: '4px',
                                  padding: '3px 8px',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                }}
                              >
                                📜 Guion
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
