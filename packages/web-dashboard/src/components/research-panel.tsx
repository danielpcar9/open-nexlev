'use client';
import React, { useEffect, useState } from 'react';
import { buildRevenueScenarios } from '@open-nexlev/niche-engine/revenue';

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'La solicitud falló');
  }
  return data;
}

const componentNames: Record<string, string> = {
  traction: 'Tracción de vistas',
  outliers: 'Frecuencia de Outliers',
  growth: 'Crecimiento reciente',
  competition: 'Competencia (inverso)',
};

const roleBadge: Record<string, string> = {
  reference: 'pill-info',
  direct_competitor: 'pill-hot',
  indirect_competitor: 'pill-accent',
  discarded: 'pill-muted',
};

export function ResearchPanel() {
  const [projects, setProjects] = useState<any[]>([]);
  const [project, setProject] = useState<any>(null);
  const [error, setError] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [name, setName] = useState('Referentes EN / competencia ES');
  const [referenceQueries, setReferenceQueries] = useState('medieval history');
  const [competitionQueries, setCompetitionQueries] = useState('historia medieval');
  const [rpm, setRpm] = useState(5);
  const [mix, setMix] = useState('mixed_unknown');
  const [roleFilter, setRoleFilter] = useState('all');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const load = () => api('/api/research').then(data => setProjects(data.projects));

  useEffect(() => {
    load().catch(err => setError(err.message));
  }, []);

  useEffect(() => {
    if (!activeJobId || !project?.id) return;
    const timer = setInterval(async () => {
      try {
        const data = await api(`/api/jobs/${activeJobId}`);
        if (data.job) {
          if (data.job.status === 'succeeded') {
            setActiveJobId(null);
            setStatusNote('Búsqueda completada con éxito.');
            const refreshed = await api(`/api/research/${project.id}`);
            setProject(refreshed.project);
            await load();
          } else if (data.job.status === 'failed' || data.job.status === 'cancelled') {
            setActiveJobId(null);
            setError(`El trabajo terminó con estado: ${data.job.status}`);
          }
        }
      } catch {
        // ignore poll error
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [activeJobId, project?.id]);

  const scenarios = buildRevenueScenarios({
    medianViews: project?.members?.[0]?.median_views ?? null,
    monthlyPosts: 8,
    observedViews: null,
    observedDays: null,
    projectedViews: null,
    projectionObservedDays: null,
    rpm,
    mix: mix as 'mixed_unknown' | 'long_only' | 'declared',
    declaredMix:
      mix === 'declared' ? 'Mezcla declarada por el usuario en la investigación' : null,
  });

  const filteredMembers = (project?.members ?? []).filter((m: any) =>
    roleFilter === 'all' ? true : m.role === roleFilter
  );

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Laboratorio de mercado y arbitraje</div>
          <h2>Investigación</h2>
          <p className="lede">
            Las consultas se guardan y se pueden editar. Un canal en español no compite automáticamente con uno en inglés. El score v1 es una heurística, no una probabilidad de éxito.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {statusNote && (
        <p role="status" className="status-banner">
          {statusNote}
        </p>
      )}

      <div className="research-layout">
        <div className="research-sidebar">
          <form
            className="subcard stack"
            onSubmit={async event => {
              event.preventDefault();
              setError('');
              setStatusNote('');
              try {
                const data = await api('/api/research', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name,
                    referenceQueries: referenceQueries
                      .split('\n')
                      .map(item => item.trim())
                      .filter(Boolean),
                    competitionQueries: competitionQueries
                      .split('\n')
                      .map(item => item.trim())
                      .filter(Boolean),
                  }),
                });
                setProject(data.project);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Error');
              }
            }}
          >
            <h3>Nueva investigación</h3>
            <label className="field">
              <span>Nombre del estudio</span>
              <input
                aria-label="Nombre de la investigación"
                value={name}
                onChange={event => setName(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Consultas de referentes (1 por línea)</span>
              <textarea
                aria-label="Consultas de referentes"
                value={referenceQueries}
                onChange={event => setReferenceQueries(event.target.value)}
                rows={3}
              />
            </label>
            <label className="field">
              <span>Consultas de competencia (1 por línea)</span>
              <textarea
                aria-label="Consultas de competencia"
                value={competitionQueries}
                onChange={event => setCompetitionQueries(event.target.value)}
                rows={3}
              />
            </label>
            <button className="btn primary" type="submit">
              + Crear investigación
            </button>
          </form>

          {projects.length > 0 && (
            <div className="subcard stack">
              <h3>Proyectos guardados ({projects.length})</h3>
              <div className="project-list">
                {projects.map(item => (
                  <button
                    className={project?.id === item.id ? 'project-item active' : 'project-item'}
                    type="button"
                    key={item.id}
                    onClick={async () => {
                      setError('');
                      setStatusNote('');
                      try {
                        setProject((await api(`/api/research/${item.id}`)).project);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Error');
                      }
                    }}
                  >
                    <strong>{item.name}</strong>
                    <span className="meta">
                      {item.sample ?? 'sin muestra'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="research-workspace">
          {!project ? (
            <div className="empty-state">
              <div className="empty-icon">🧭</div>
              <strong>Selecciona o crea una investigación</strong>
              <p className="meta">
                Compara canales referentes (p. ej. en inglés) frente a competidores directos en tu idioma objetivo, extrae patrones de títulos y calcula escenarios de RPM.
              </p>
            </div>
          ) : (
            <div className="stack-lg">
              <div className="subcard project-hero">
                <div>
                  <div className="tracked-title-row">
                    <h3>{project.name}</h3>
                    <span className="pill pill-info">Muestra: {project.sample ?? 'pendiente'}</span>
                  </div>
                  <p className="lede">{project.note}</p>
                </div>
                <button
                  className="btn primary"
                  type="button"
                  disabled={Boolean(activeJobId)}
                  onClick={async () => {
                    setError('');
                    setStatusNote('');
                    try {
                      const data = await api(`/api/research/${project.id}/run`, {
                        method: 'POST',
                      });
                      setActiveJobId(data.jobId);
                      setError(`Búsqueda encolada: ${data.jobId}. No es un resultado todavía.`);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Error');
                    }
                  }}
                >
                  {activeJobId ? 'Ejecutando en worker…' : '▶ Ejecutar consultas'}
                </button>
              </div>

              <div className="subcard">
                <div className="section-head">
                  <h3>Score v1</h3>
                  {project.score?.certainty && (
                    <span className="pill pill-accent">Certeza: {project.score.certainty}</span>
                  )}
                </div>

                {project.score ? (
                  <>
                    <div className="score-banner">
                      <div className="score-value num">
                        {project.score.score == null ? '—' : project.score.score.toFixed(1)}
                        <span>/100</span>
                      </div>
                      <p className="score-msg">
                        {project.score.message}{' '}
                        {project.score.score == null
                          ? ''
                          : `Valor ${project.score.score.toFixed(1)} (certeza ${project.score.certainty}).`}
                      </p>
                    </div>
                    <div className="score-grid">
                      {Object.entries(project.score.components).map(([key, component]: any) => (
                        <div className="score-card" key={key}>
                          <div className="score-card-top">
                            <strong>{componentNames[key] ?? key}</strong>
                            <span className="pill pill-muted">{component.status}</span>
                          </div>
                          <div className="score-metrics num">
                            <span>Absoluto: {component.absolute ?? '—'}</span>
                            <span>Percentil: {component.percentile != null ? `${component.percentile}%` : '—'}</span>
                          </div>
                          <div className="progress-track">
                            <div
                              className="progress-fill"
                              style={{ width: `${Math.min(100, Math.max(0, component.percentile ?? 0))}%` }}
                            />
                          </div>
                          <p className="meta">{component.detail}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="meta">Ranking aún no calculado.</p>
                )}
              </div>

              <div className="subcard">
                <div className="section-head">
                  <h3>Canales ({project.members.length})</h3>
                  <div className="filter-pills">
                    {[
                      ['all', 'Todos'],
                      ['reference', 'Referentes'],
                      ['direct_competitor', 'Comp. directos'],
                      ['indirect_competitor', 'Comp. indirectos'],
                      ['discarded', 'Descartados'],
                    ].map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        className={roleFilter === val ? 'chip active' : 'chip'}
                        onClick={() => setRoleFilter(val)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {project.members.length === 0 ? (
                  <p className="empty">Todavía no hay canales. Ejecuta las consultas con el worker activo.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Canal</th>
                          <th>Rol</th>
                          <th>Idioma</th>
                          <th>Mediana</th>
                          <th>Suscriptores</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMembers.map((member: any) => (
                          <tr key={member.channel_id}>
                            <td>
                              <div className="member-cell">
                                <a
                                  href={`https://www.youtube.com/channel/${member.channel_id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {member.title} ↗
                                </a>
                                <span className={`pill ${roleBadge[member.role] ?? 'pill-muted'}`}>
                                  {member.role}
                                </span>
                              </div>
                            </td>
                            <td>
                              <select
                                aria-label={`Rol de ${member.title}`}
                                value={member.role}
                                onChange={async event => {
                                  setError('');
                                  try {
                                    setProject(
                                      (
                                        await api(
                                          `/api/research/${project.id}/channels/${member.channel_id}`,
                                          {
                                            method: 'PATCH',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ role: event.target.value }),
                                          }
                                        )
                                      ).project
                                    );
                                  } catch (err) {
                                    setError(err instanceof Error ? err.message : 'Error');
                                  }
                                }}
                              >
                                <option value="reference">referente</option>
                                <option value="direct_competitor">competidor directo</option>
                                <option value="indirect_competitor">competidor indirecto</option>
                                <option value="discarded">descartado</option>
                              </select>
                            </td>
                            <td>
                              <span className="pill pill-muted">
                                {member.language ?? 'desconocido'}{' '}
                                {member.language_manual ? '(manual)' : ''}
                              </span>
                            </td>
                            <td className="num">
                              {member.median_views != null
                                ? member.median_views.toLocaleString()
                                : '—'}
                            </td>
                            <td className="num">
                              {member.subscribers != null
                                ? member.subscribers.toLocaleString()
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="subcard">
                <h3>Patrones de títulos</h3>
                {(project.patterns ?? []).length === 0 ? (
                  <p className="meta">Aparecen cuando la muestra tiene títulos.</p>
                ) : (
                  <div className="patterns-grid">
                    {(project.patterns ?? []).slice(0, 8).map((pattern: any) => (
                      <div className="pattern-card" key={pattern.phrase}>
                        <strong className="pattern-phrase">“{pattern.phrase}”</strong>
                        <p className="meta">{pattern.statement}</p>
                        <div className="pattern-links">
                          {pattern.examples.map((example: any) => (
                            <a
                              key={example.videoId}
                              className="chip"
                              href={`https://www.youtube.com/watch?v=${example.videoId}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              ▶ {example.videoId}
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="subcard">
                <h3>Escenarios de ingresos</h3>
                <div className="inline">
                  <label className="field">
                    <span>RPM supuesto (USD)</span>
                    <input
                      aria-label="RPM supuesto"
                      className="num"
                      type="number"
                      step="0.5"
                      value={rpm}
                      onChange={event => setRpm(Number(event.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span>Mezcla de formatos</span>
                    <select
                      aria-label="Hipótesis de mezcla"
                      value={mix}
                      onChange={event => setMix(event.target.value)}
                    >
                      <option value="mixed_unknown">desconocida</option>
                      <option value="long_only">solo largos</option>
                      <option value="declared">declarada</option>
                    </select>
                  </label>
                </div>

                <div className="scenario-grid">
                  {scenarios.map(scenario => (
                    <div
                      className={scenario.disabled ? 'scenario-card disabled' : 'scenario-card'}
                      key={scenario.id}
                    >
                      <span className="meta-label">{scenario.label}</span>
                      <div className="scenario-val num">
                        {scenario.disabled ? 'Deshabilitado' : `$${scenario.usd?.toLocaleString()}/mes`}
                      </div>
                      <p className="meta">{scenario.hypothesis}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
