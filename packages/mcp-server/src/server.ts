#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { NicheFinderEngine } from '@open-nexlev/niche-engine';

const engine = new NicheFinderEngine();

const server = new McpServer({
  name: 'open-nexlev-mcp',
  version: '1.0.0',
});

// HERRAMIENTA 1: Descubridor de Nichos y Outliers
server.tool(
  'discover_youtube_niches',
  'Busca canales pequeños de YouTube en un nicho que tengan videos virales (outliers) sin usar cuota de API.',
  {
    query: z.string().describe('Palabra clave o semilla del nicho (ej. "medieval history", "stoicism", "nasa documentary")'),
    maxSubscribers: z.number().optional().default(50000).describe('Máximo de suscriptores del canal para encontrar canales nuevos'),
    minOutlierScore: z.number().optional().default(3.0).describe('Multiplicador mínimo de vistas sobre la mediana del canal (ej. 3.0 = 3x más vistas)'),
    minMedianViews: z.number().optional().default(5000).describe('Mínimo de vistas medianas del canal'),
  },
  async ({ query, maxSubscribers, minOutlierScore, minMedianViews }) => {
    const channels = await engine.discoverNicheChannels({
      query,
      maxSubscribers,
      minOutlierScore,
      minMedianViews,
      maxChannelsToAnalyze: 10,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(channels, null, 2),
        },
      ],
    };
  }
);

// HERRAMIENTA 2: Radiografía profunda de un canal específico
server.tool(
  'analyze_youtube_channel',
  'Calcula la mediana de vistas de un canal de YouTube, estima su RPM mensual y extrae todos sus videos Outliers con el multiplicador exacto.',
  {
    channelId: z.string().describe('ID del canal de YouTube (empieza con UC...)'),
    minOutlierScore: z.number().optional().default(2.0).describe('Puntaje mínimo de outlier para filtrar'),
  },
  async ({ channelId, minOutlierScore }) => {
    const data = await engine.analyzeChannel(channelId, minOutlierScore);
    if (!data) {
      return {
        content: [{ type: 'text', text: 'No se pudo analizar el canal o tiene muy pocos videos.' }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }
);

// HERRAMIENTA 3: Extractor de Guion / Transcripción limpia en 1 clic
server.tool(
  'get_video_transcript',
  'Extrae la transcripción completa (guion limpio y segmentos con timestamps) de cualquier video de YouTube sin usar API Key.',
  {
    videoIdOrUrl: z.string().describe('ID del video de YouTube (11 caracteres) o URL completa del video'),
    includeTimestamps: z.boolean().optional().default(false).describe('Si es true, devuelve cada línea con su marca de tiempo [MM:SS]'),
  },
  async ({ videoIdOrUrl, includeTimestamps }) => {
    let transcript;
    try { transcript = await engine.getVideoTranscript(videoIdOrUrl); }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Error extrayendo transcripción' }] }; }
    if (!transcript) {
      return {
        content: [{ type: 'text', text: 'No se encontró transcripción disponible para este video.' }],
        isError: true,
      };
    }

    const formattedOutput = includeTimestamps
      ? transcript.segments.map((s) => `[${s.timestamp}] ${s.text}`).join('\n')
      : transcript.cleanText;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              videoId: transcript.videoId,
              title: transcript.title,
              wordCount: transcript.wordCount,
              script: formattedOutput,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Error iniciando MCP Server:', err);
  process.exit(1);
});
