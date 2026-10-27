'use client';
import React, { useEffect, useState } from 'react';
import { buildRevenueScenarios } from '@open-nexlev/niche-engine/revenue';

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || 'La solicitud falló');
  return data;
}

export function ResearchPanel() {
  const [projects, setProjects] = useState<any[]>([]);
  const [project, setProject] = useState<any>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('Referentes EN / competencia ES');
  const [referenceQueries, setReferenceQueries] = useState('medieval history');
  const [competitionQueries, setCompetitionQueries] = useState('historia medieval');
  const [rpm, setRpm] = useState(5);
  const [mix, setMix] = useState('mixed_unknown');
  const load = () => api('/api/research').then(data => setProjects(data.projects));
  useEffect(() => { load().catch(err => setError(err.message)); }, []);
  const scenarios = buildRevenueScenarios({ medianViews: project?.members?.[0]?.median_views ?? null, monthlyPosts: 8, observedViews: null, observedDays: null, projectedViews: null, projectionObservedDays: null, rpm, mix: mix as 'mixed_unknown' | 'long_only' | 'declared', declaredMix: mix === 'declared' ? 'Mezcla declarada por el usuario en la investigación' : null });
  return (
    <section style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Investigación</h2>
      <p style={{ color: '#94a3b8', fontSize: 13 }}>Las consultas se guardan y se pueden editar. Un canal en español no compite automáticamente con uno en inglés. El score v1 es una heurística, no una probabilidad de éxito.</p>
      {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
      <form onSubmit={async event => { event.preventDefault(); setError(''); try { const data = await api('/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, referenceQueries: referenceQueries.split('\n').map(item => item.trim()).filter(Boolean), competitionQueries: competitionQueries.split('\n').map(item => item.trim()).filter(Boolean) }) }); setProject(data.project); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }} style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        <input aria-label="Nombre de la investigación" value={name} onChange={event => setName(event.target.value)} style={{ padding: 10, borderRadius: 8, border: '1px solid #374151', background: '#030712', color: '#fff' }} />
        <textarea aria-label="Consultas de referentes" value={referenceQueries} onChange={event => setReferenceQueries(event.target.value)} rows={3} style={{ padding: 10, borderRadius: 8, border: '1px solid #374151', background: '#030712', color: '#fff' }} />
        <textarea aria-label="Consultas de competencia" value={competitionQueries} onChange={event => setCompetitionQueries(event.target.value)} rows={3} style={{ padding: 10, borderRadius: 8, border: '1px solid #374151', background: '#030712', color: '#fff' }} />
        <button style={{ padding: 10, border: 0, borderRadius: 8, background: '#7c3aed', color: '#fff', fontWeight: 700 }}>Crear investigación</button>
      </form>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {projects.map(item => <button type="button" key={item.id} onClick={async () => { setError(''); try { setProject((await api(`/api/research/${item.id}`)).project); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>{item.name}</button>)}
      </div>
      {project && (
        <div>
          <p>{project.note}</p>
          <button type="button" onClick={async () => { setError(''); try { const data = await api(`/api/research/${project.id}/run`, { method: 'POST' }); setError(`Búsqueda encolada: ${data.jobId}. No es un resultado todavía.`); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>Ejecutar consultas</button>
          <h3>Score</h3>
          {project.score ? <p>{project.score.message} {project.score.score == null ? '' : `Valor ${project.score.score.toFixed(1)} (certeza ${project.score.certainty}).`}</p> : <p>Ranking aún no calculado.</p>}
          {project.score && Object.entries(project.score.components).map(([key, component]: any) => <p key={key}>{key}: {component.status} · absoluto {component.absolute ?? '—'} · percentil {component.percentile ?? '—'} · {component.detail}</p>)}
          <h3>Canales</h3>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr><th align="left">Canal</th><th>Rol</th><th>Idioma</th><th>Mediana</th><th>Suscriptores</th></tr></thead>
            <tbody>
              {project.members.map((member: any) => (
                <tr key={member.channel_id}>
                  <td>{member.title}</td>
                  <td>
                    <select aria-label={`Rol de ${member.title}`} value={member.role} onChange={async event => { setError(''); try { setProject((await api(`/api/research/${project.id}/channels/${member.channel_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: event.target.value }) })).project); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } }}>
                      <option value="reference">referente</option>
                      <option value="direct_competitor">competidor directo</option>
                      <option value="indirect_competitor">competidor indirecto</option>
                      <option value="discarded">descartado</option>
                    </select>
                  </td>
                  <td>{member.language ?? 'desconocido'} {member.language_manual ? '(manual)' : ''}</td>
                  <td>{member.median_views ?? '—'}</td>
                  <td>{member.subscribers ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {project.members.length === 0 && <p>Todavía no hay canales. Ejecuta las consultas con el worker activo.</p>}
          <h3>Patrones de títulos</h3>
          {(project.patterns ?? []).slice(0, 8).map((pattern: any) => (
            <p key={pattern.phrase}>{pattern.phrase}: {pattern.statement} {pattern.examples.map((example: any) => <a key={example.videoId} href={`https://www.youtube.com/watch?v=${example.videoId}`} target="_blank" rel="noreferrer">{example.videoId} </a>)}</p>
          ))}
          <h3>Escenarios de ingresos</h3>
          <label>RPM supuesto <input aria-label="RPM supuesto" type="number" value={rpm} onChange={event => setRpm(Number(event.target.value))} /></label>
          <label> Mezcla <select aria-label="Hipótesis de mezcla" value={mix} onChange={event => setMix(event.target.value)}><option value="mixed_unknown">desconocida</option><option value="long_only">solo largos</option><option value="declared">declarada</option></select></label>
          {scenarios.map(scenario => <p key={scenario.id}><strong>{scenario.label}:</strong> {scenario.disabled ? 'deshabilitado' : `$${scenario.usd}`} — {scenario.hypothesis}</p>)}
        </div>
      )}
    </section>
  );
}
