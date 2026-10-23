# Open-NexLev

Herramientas open source para investigar nichos de YouTube: motor de análisis, dashboard, extensión Chrome y servidor MCP. Proyecto independiente inspirado en funcionalidades de NexLev, sin afiliación con esa marca ni con YouTube.

## Requisitos e instalación

Node.js 22 LTS y npm. Desde la raíz:

```sh
npm ci
npm run dev:dashboard  # http://localhost:3000
npm run dev:extension  # WXT / Chrome
npm run start:mcp     # transporte stdio
```

## Paquetes

- `packages/niche-engine`: búsqueda mediante youtubei.js, mediana de hasta 25 videos, outliers respecto al canal y extracción de transcripciones disponibles.
- `packages/web-dashboard`: Next.js, filtros, calculadora de ingresos hipotéticos, extractor y Swipe File guardado en localStorage del navegador.
- `packages/chrome-extension`: badges relativos a la cuadrícula visible, VPH aproximadas, copia de subtítulos y enlace a miniatura. Carga `packages/chrome-extension/.output/chrome-mv3` como extensión descomprimida tras compilar.
- `packages/mcp-server`: `discover_youtube_niches`, `analyze_youtube_channel` y `get_video_transcript`.

## Comprobaciones

```sh
npm test               # pruebas unitarias sin YouTube
npm run typecheck      # los cuatro paquetes
npm run build          # dashboard y extensión
npm run test:engine    # prueba en vivo; requiere conexión a YouTube
```

Para un cliente MCP configura un comando `npm`, con argumentos `--prefix`, la ruta absoluta al repositorio, `run`, `start:mcp`, `--silent`.

## Alcance y limitaciones

- No requiere clave de YouTube Data API. Los endpoints internos pueden cambiar, bloquear solicitudes o requerir autenticación. No se garantiza extraer subtítulos de cualquier video.
- El Swipe File persiste solo en el navegador. Existe un esquema Drizzle/SQLite y configuración de `db:push`, pero **el dashboard no está conectado a SQLite**. No hay sincronización entre dispositivos.
- Los badges de la extensión usan la mediana de tarjetas visibles; no representan la mediana histórica del canal. VPH significa vistas totales divididas entre edad aproximada, no velocidad reciente.
- Los ingresos son un escenario de mediana × 8 videos/mes × RPM/1000; no ingresos observados ni una predicción verificada.
- El dashboard está pensado para uso local. No incluye cuentas ni límites de uso para alojarlo públicamente.
- Las miniaturas maxres no existen para todos los videos. El extractor de la extensión depende del HTML y del acceso a timedtext.

Licencia MIT. Consulta `REVIEW.md` para el resultado de la revisión inicial.
