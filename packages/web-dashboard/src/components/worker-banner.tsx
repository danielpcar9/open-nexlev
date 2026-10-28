'use client';
import React, { useEffect, useState } from 'react';

interface WorkerStatus {
  running: boolean;
  message: string;
  command: string;
  lastSeenAt: string | null;
}

export function WorkerBanner() {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch('/api/worker/status', { cache: 'no-store' })
        .then(response => response.json())
        .then(data => {
          if (!stop && data.ok) setStatus(data);
        })
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 10000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  if (!status) return null;

  const copyCommand = () => {
    navigator.clipboard
      .writeText(status.command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  return (
    <div
      role="status"
      className={status.running ? 'banner banner-ok' : 'banner banner-stop'}
    >
      <div className="banner-main">
        <span
          className={status.running ? 'pulse-dot online' : 'pulse-dot offline'}
          aria-hidden="true"
        />
        <div className="banner-text">
          <strong>{status.running ? 'Worker activo' : 'Worker detenido'}</strong>
          <span>
            {status.message}{' '}
            {status.lastSeenAt
              ? `Último heartbeat: ${new Date(status.lastSeenAt).toLocaleString()}.`
              : ''}
          </span>
        </div>
      </div>
      <div className="banner-cmd">
        <span className="banner-cmd-label">Comando:</span>
        <code>{status.command}</code>
        <button
          type="button"
          className="btn-icon-tiny"
          onClick={copyCommand}
          title="Copiar comando"
        >
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}
