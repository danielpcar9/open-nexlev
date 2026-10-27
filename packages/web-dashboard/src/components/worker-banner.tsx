'use client';
import React, { useEffect, useState } from 'react';

export function WorkerBanner() {
  const [status, setStatus] = useState<{ running: boolean; message: string; command: string; lastSeenAt: string | null } | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () => fetch('/api/worker/status', { cache: 'no-store' }).then(response => response.json()).then(data => { if (!stop && data.ok) setStatus(data); }).catch(() => undefined);
    load();
    const timer = setInterval(load, 10000);
    return () => { stop = true; clearInterval(timer); };
  }, []);
  if (!status) return null;
  return (
    <p role="status" style={{ margin: '0 0 16px', padding: '10px 12px', borderRadius: 8, background: status.running ? '#052e16' : '#451a1a', color: status.running ? '#bbf7d0' : '#fecaca', fontSize: 13 }}>
      {status.message} {status.lastSeenAt ? `Último heartbeat: ${new Date(status.lastSeenAt).toLocaleString()}.` : ''} Comando: <code>{status.command}</code>
    </p>
  );
}
