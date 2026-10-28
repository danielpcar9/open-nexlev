import { fetchVideoTranscript } from '@open-nexlev/niche-engine/transcript';
import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    const BADGE_CLASS = 'open-nexlev-outlier-badge';
    const TOOLBAR_ID = 'open-nexlev-watch-toolbar';

    // 1. Inyectar estilos CSS modernos para los badges sobre miniaturas y la barra de herramientas del reproductor
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
        padding: 4px 10px;
        border-radius: 999px;
        font-family: 'Inter', 'Roboto', sans-serif;
        font-size: 11px;
        font-weight: 700;
        color: #ffffff;
        backdrop-filter: blur(12px);
        box-shadow: 0 4px 14px rgba(0,0,0,0.5);
        pointer-events: none;
        letter-spacing: 0.25px;
      }
      .nexlev-tier-normal { background: rgba(10, 14, 22, 0.86); border: 1px solid rgba(255,255,255,0.14); }
      .nexlev-tier-good   { background: linear-gradient(135deg, rgba(124, 58, 237, 0.94), rgba(79, 70, 229, 0.94)); border: 1px solid rgba(196, 181, 253, 0.45); }
      .nexlev-tier-viral  { background: linear-gradient(135deg, #f43f5e, #f59e0b); border: 1px solid rgba(255, 255, 255, 0.35); box-shadow: 0 4px 16px rgba(244, 63, 94, 0.45); }
      .nexlev-vph {
        font-size: 10px;
        font-weight: 600;
        opacity: 0.92;
        border-left: 1px solid rgba(255,255,255,0.28);
        padding-left: 6px;
      }
      #${TOOLBAR_ID} {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        margin: 12px 0;
        padding: 10px 14px;
        border-radius: 14px;
        background: rgba(12, 16, 25, 0.88);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(139, 92, 246, 0.4);
        box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5);
        font-family: 'Inter', 'Roboto', sans-serif;
        color: #f8fafc;
      }
      .nexlev-btn {
        cursor: pointer;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(25, 33, 50, 0.95);
        color: #f8fafc;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 12px;
        border-radius: 8px;
        transition: all 0.16s ease;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .nexlev-btn:hover {
        background: linear-gradient(135deg, #8b5cf6, #6366f1);
        border-color: rgba(255, 255, 255, 0.25);
        transform: translateY(-1px);
      }
      .nexlev-brand {
        font-size: 11px;
        font-weight: 800;
        color: #c4b5fd;
        margin-right: 6px;
        letter-spacing: 0.6px;
        padding: 4px 8px;
        border-radius: 6px;
        background: rgba(139, 92, 246, 0.16);
        border: 1px solid rgba(139, 92, 246, 0.35);
      }
    `;
    document.head.appendChild(style);

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

    async function extractCleanTranscript(withTimestamps = false): Promise<string> {
      const videoId = new URLSearchParams(window.location.search).get('v');
      if (!videoId) throw new Error('No se detectó ID de video.');

      const transcript = await fetchVideoTranscript(videoId);
      return withTimestamps
        ? transcript.segments.map(segment => `[${segment.timestamp}] ${segment.text}`).join('\n')
        : transcript.cleanText;
    }

    function injectWatchToolbar() {
      if (!window.location.pathname.startsWith('/watch')) return;
      if (document.getElementById(TOOLBAR_ID)) return;

      const targetContainer = document.querySelector('#above-the-fold #title, ytd-watch-metadata #title');
      if (!targetContainer || !targetContainer.parentElement) return;

      const toolbar = document.createElement('div');
      toolbar.id = TOOLBAR_ID;
      toolbar.innerHTML = `
        <span class="nexlev-brand">ON · OPEN-NEXLEV</span>
        <button class="nexlev-btn" id="nexlev-copy-clean">📋 Copiar Guion Limpio</button>
        <button class="nexlev-btn" id="nexlev-copy-timestamps">⏱️ Con Timestamps</button>
        <button class="nexlev-btn" id="nexlev-download-thumb">🖼️ Miniatura MaxRes</button>
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
