import { fetchVideoTranscript } from '@open-nexlev/niche-engine/transcript';
import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    const BADGE_CLASS = 'open-nexlev-outlier-badge';
    const TOOLBAR_ID = 'open-nexlev-watch-toolbar';

    // 1. Inyectar estilos CSS limpios para los badges sobre miniaturas y la barra de herramientas del reproductor
    const style = document.createElement('style');
    style.textContent = `
      .${BADGE_CLASS} {
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 20;
        display: flex;
        gap: 6px;
        align-items: center;
        padding: 4px 8px;
        border-radius: 6px;
        font-family: 'Roboto', sans-serif;
        font-size: 12px;
        font-weight: 700;
        color: #ffffff;
        backdrop-filter: blur(8px);
        box-shadow: 0 2px 10px rgba(0,0,0,0.45);
        pointer-events: none;
        letter-spacing: 0.3px;
      }
      .nexlev-tier-normal { background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255,255,255,0.15); }
      .nexlev-tier-good   { background: rgba(22, 163, 74, 0.92); border: 1px solid #4ade80; }
      .nexlev-tier-viral  { background: linear-gradient(135deg, #7c3aed, #db2777); border: 1px solid #f472b6; }
      .nexlev-vph {
        font-size: 10px;
        font-weight: 500;
        opacity: 0.9;
        border-left: 1px solid rgba(255,255,255,0.3);
        padding-left: 6px;
      }
      #${TOOLBAR_ID} {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        margin: 10px 0;
        padding: 10px 14px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.9);
        border: 1px solid rgba(124, 58, 237, 0.45);
        font-family: 'Roboto', sans-serif;
        color: #f8fafc;
      }
      .nexlev-btn {
        cursor: pointer;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(30, 41, 59, 0.95);
        color: #f8fafc;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 12px;
        border-radius: 6px;
        transition: all 0.15s ease;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .nexlev-btn:hover {
        background: #7c3aed;
        border-color: #a78bfa;
      }
      .nexlev-brand {
        font-size: 12px;
        font-weight: 800;
        color: #c084fc;
        margin-right: 6px;
        letter-spacing: 0.4px;
      }
    `;
    document.head.appendChild(style);

    // 2. Parser de vistas multi-idioma (Inglés y Español: "120 K vistas", "1.4M views")
    function parseViews(text: string): number {
      const clean = text.replace(/,/g, '.').toUpperCase();
      const match = clean.match(/([\d.]+)\s*(MIL|K|M|B)?/);
      if (!match) return 0;

      let num = parseFloat(match[1]!);
      const unit = match[2] || '';

      if (!unit && clean.includes('.') && (clean.split('.')[1]?.length ?? 0) >= 3) {
        num = parseFloat(text.replace(/[.,]/g, ''));
      }

      if (unit === 'K' || unit === 'MIL') num *= 1_000;
      else if (unit.startsWith('M')) num *= 1_000_000;
      else if (unit === 'B') num *= 1_000_000_000;

      return Math.round(num);
    }

    // 3. Estimador de Horas desde publicación para calcular VPH (Vistas por Hora)
    function parseHoursAgo(text: string): number {
      const lower = text.toLowerCase();
      const match = lower.match(/(\d+)/);
      if (!match) return 24;
      const val = parseInt(match[1]!, 10);

      if (lower.includes('min')) return Math.max(0.5, val / 60);
      if (lower.includes('hour') || lower.includes('hora')) return val;
      if (lower.includes('day') || lower.includes('día') || lower.includes('dia')) return val * 24;
      if (lower.includes('week') || lower.includes('semana')) return val * 24 * 7;
      if (lower.includes('month') || lower.includes('mes')) return val * 24 * 30;
      if (lower.includes('year') || lower.includes('año')) return val * 24 * 365;
      return 24;
    }

    function getMedian(numbers: number[]): number {
      if (!numbers.length) return 0;
      const sorted = [...numbers].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    }

    // 4. Extractor de Transcripción en 1 clic directamente desde ytInitialPlayerResponse (timedtext)
    async function extractCleanTranscript(withTimestamps = false): Promise<string> {
      const videoId = new URLSearchParams(window.location.search).get('v');
      if (!videoId) throw new Error('No se detectó ID de video.');

      const transcript = await fetchVideoTranscript(videoId);
      return withTimestamps
        ? transcript.segments.map(segment => `[${segment.timestamp}] ${segment.text}`).join('\n')
        : transcript.cleanText;
    }

    // 5. Inyectar barra de herramientas en páginas de reproducción (/watch?v=...)
    function injectWatchToolbar() {
      if (!window.location.pathname.startsWith('/watch')) return;
      if (document.getElementById(TOOLBAR_ID)) return;

      const targetContainer = document.querySelector('#above-the-fold #title, ytd-watch-metadata #title');
      if (!targetContainer || !targetContainer.parentElement) return;

      const toolbar = document.createElement('div');
      toolbar.id = TOOLBAR_ID;
      toolbar.innerHTML = `
        <span class="nexlev-brand">⚡ OPEN-NEXLEV</span>
        <button class="nexlev-btn" id="nexlev-copy-clean">📋 Copiar Guion Limpio (1-Clic)</button>
        <button class="nexlev-btn" id="nexlev-copy-timestamps">⏱️ Copiar con Timestamps</button>
        <button class="nexlev-btn" id="nexlev-download-thumb">🖼️ Miniatura HD (MaxRes)</button>
      `;

      targetContainer.parentElement.insertBefore(toolbar, targetContainer.nextSibling);

      const btnClean = toolbar.querySelector('#nexlev-copy-clean') as HTMLButtonElement;
      const btnTime = toolbar.querySelector('#nexlev-copy-timestamps') as HTMLButtonElement;
      const btnThumb = toolbar.querySelector('#nexlev-download-thumb') as HTMLButtonElement;

      btnClean?.addEventListener('click', async () => {
        const original = btnClean.textContent;
        try {
          btnClean.textContent = '⏳ Extrayendo...';
          const script = await extractCleanTranscript(false);
          await navigator.clipboard.writeText(script);
          const words = script.split(/\s+/).length;
          btnClean.textContent = `✅ ¡Copiado! (${words} palabras)`;
        } catch (err: any) {
          btnClean.textContent = `❌ ${err.message || 'Sin subtítulos'}`;
        } finally {
          setTimeout(() => {
            btnClean.textContent = original;
          }, 3000);
        }
      });

      btnTime?.addEventListener('click', async () => {
        const original = btnTime.textContent;
        try {
          btnTime.textContent = '⏳ Extrayendo...';
          const script = await extractCleanTranscript(true);
          await navigator.clipboard.writeText(script);
          btnTime.textContent = '✅ ¡Timestamps copiados!';
        } catch (err: any) {
          btnTime.textContent = `❌ ${err.message || 'Error'}`;
        } finally {
          setTimeout(() => {
            btnTime.textContent = original;
          }, 3000);
        }
      });

      btnThumb?.addEventListener('click', () => {
        const videoId = new URLSearchParams(window.location.search).get('v');
        if (videoId) {
          window.open(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, '_blank');
        }
      });
    }

    // 6. Escáner de tarjetas de video en el DOM (Outlier Score + VPH)
    function processYouTubeGrid() {
      injectWatchToolbar();

      const cards = Array.from(
        document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer')
      ) as HTMLElement[];

      if (cards.length < 3) return;

      const cardData = cards
        .map((card) => {
          const metaSpans = Array.from(
            card.querySelectorAll('#metadata-line span.inline-metadata-item, ytd-video-meta-block span')
          );
          const viewsText = metaSpans[0]?.textContent?.trim() || '';
          const dateText = metaSpans[1]?.textContent?.trim() || '';
          const views = parseViews(viewsText);
          const hours = parseHoursAgo(dateText);

          return { card, views, hours };
        })
        .filter((item) => item.views > 0);

      const medianViews = getMedian(cardData.map((d) => d.views));
      if (medianViews === 0) return;

      for (const { card, views, hours } of cardData) {
        const thumbnailContainer = card.querySelector('ytd-thumbnail, a#thumbnail') as HTMLElement | null;
        if (!thumbnailContainer) continue;

        const outlierScore = Number((views / medianViews).toFixed(1));
        const vph = Math.round(views / Math.max(0.5, hours));

        let badge = thumbnailContainer.querySelector(`.${BADGE_CLASS}`) as HTMLElement | null;
        if (!badge) {
          badge = document.createElement('div');
          badge.className = BADGE_CLASS;
          thumbnailContainer.style.position = 'relative';
          thumbnailContainer.appendChild(badge);
        }

        badge.classList.remove('nexlev-tier-normal', 'nexlev-tier-good', 'nexlev-tier-viral');
        let icon = '';
        if (outlierScore >= 5.0) {
          badge.classList.add('nexlev-tier-viral');
          icon = '🔥 ';
        } else if (outlierScore >= 2.0) {
          badge.classList.add('nexlev-tier-good');
          icon = '⚡ ';
        } else {
          badge.classList.add('nexlev-tier-normal');
        }

        const vphFormatted = vph > 1000 ? `${(vph / 1000).toFixed(1)}K/h` : `${vph}/h`;
        const markup = `
          <span>${icon}${outlierScore}x grid</span>
          <span class="nexlev-vph">${vphFormatted}</span>
        `;
        if (badge.innerHTML !== markup) badge.innerHTML = markup;
      }
    }

    // 7. Observar cambios en el DOM (navegación SPA de YouTube y scroll infinito)
    let timeoutId: number | null = null;
    const observer = new MutationObserver(() => {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(processYouTubeGrid, 350);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('yt-navigate-finish', () => {
      const existingToolbar = document.getElementById(TOOLBAR_ID);
      if (existingToolbar) existingToolbar.remove();
      setTimeout(processYouTubeGrid, 500);
    });
    processYouTubeGrid();
  },
});
