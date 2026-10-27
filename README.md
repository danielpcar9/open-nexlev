# Open-NexLev

Herramientas open source para investigar nichos de YouTube: motor de análisis, dashboard, extensión Chrome y servidor MCP. Proyecto independiente inspirado en funcionalidades de NexLev, sin afiliación con esa marca ni con YouTube.

## Requisitos e instalación

Node.js 22 LTS y npm (`nvm use` si tienes nvm). Desde la raíz:

```sh
npm ci
npm run dev:dashboard  # http://localhost:3000
npm run dev:extension  # WXT / Chrome
npm run start:mcp     # transporte stdio
```

## Paquetes

- `packages/niche-engine`: búsqueda mediante youtubei.js, mediana de hasta 25 videos, outliers respecto al canal y extracción de transcripciones disponibles.
- `packages/web-dashboard`: Next.js, filtros, calculadora de ingresos hipotéticos, extractor y Swipe File persistente en SQLite mediante Drizzle.
- `packages/chrome-extension`: badges relativos a la cuadrícula visible, VPH aproximadas, copia de subtítulos y enlace a miniatura. Carga `packages/chrome-extension/.output/chrome-mv3` como extensión descomprimida tras compilar.
- `packages/mcp-server`: `discover_youtube_niches`, `analyze_youtube_channel` y `get_video_transcript`.

## Comprobaciones

```sh
npm test                 # pruebas unitarias sin YouTube
npm run test:integration # cola, worker y reinicio, sin YouTube
npm run typecheck        # los cuatro paquetes
npm run build            # dashboard y extensión
npm run db:migrate       # migraciones versionadas de SQLite
npm run worker           # capturas automáticas; hace falta tenerlo en marcha
npm run test:engine      # prueba en vivo; requiere conexión a YouTube y no corre en CI
```

Para un cliente MCP configura un comando `npm`, con argumentos `--prefix`, la ruta absoluta al repositorio, `run`, `start:mcp`, `--silent`.

## Seguimiento e investigación

El dashboard puede seguir canales, guardar observaciones con fecha, fuente y precisión, mostrar ventanas de 24 h, 7 d y 30 d, proyectar un mes solo cuando falta esa cobertura, y avisar una vez por outlier nuevo, aceleración comparable o capturas fallidas. Guardar en el Swipe File no empieza el seguimiento. Las investigaciones comparan consultas de referentes y de competencia; el score v1 explica su cobertura y no trata una búsqueda fallida como ausencia de competencia. El detalle operativo, la retención y la copia consistente de SQLite están en [docs/OPERACION.md](docs/OPERACION.md).

YouTube Data API es opcional y permanece apagada hasta confirmar su política de almacenamiento. Innertube sigue bastando para el Swipe File, las transcripciones y el seguimiento.

## Alcance y limitaciones

- No requiere clave de YouTube Data API. Los endpoints internos pueden cambiar, bloquear solicitudes o requerir autenticación. No se garantiza extraer subtítulos de cualquier video.
- El Swipe File se guarda en `packages/web-dashboard/open-nexlev.db`. Las rutas relativas de `DATABASE_URL` se resuelven contra ese paquete aunque el proceso se lance desde otro directorio. La migración conserva los guardados anteriores. Para otra ubicación usa una ruta absoluta. Los guardados antiguos de localStorage se importan al abrir el dashboard y solo se borran del navegador tras confirmar la importación. La biblioteca es compartida por quienes usan esa instancia; no hay cuentas de usuario.
- Los badges de la extensión usan la mediana de la cuadrícula visible; no representan la mediana histórica del canal. VPH significa vistas totales divididas entre edad aproximada, no velocidad reciente.
- «Por publicación» es mediana × publicaciones mensuales asumidas × RPM supuesto / 1000. No es un ingreso observado. Si el canal mezcla formatos y no declaras la hipótesis, el escenario automático no se calcula.
- El dashboard está pensado para uso local. Rechaza escrituras cuyo Host no sea `localhost` o `127.0.0.1` en el puerto configurado, salvo `ALLOWED_HOSTS`. No incluye cuentas ni límites de uso para alojarlo públicamente.
- Las miniaturas maxres no existen para todos los videos. Dashboard, MCP y extensión comparten el extractor JSON3 de pistas públicas de YouTube, con un límite de 20 segundos por extracción. No transcribe audio sin subtítulos ni accede a videos privados. Los errores de red se distinguen de la ausencia de subtítulos.
- GitHub Actions estaba bloqueado por facturación en la revisión previa. Si los jobs no arrancan, ejecuta las comprobaciones en local; el bloqueo no equivale a un fallo del código ni a un CI verde.

## Copia de seguridad

No copies únicamente el `.db` mientras haya escrituras. Detén dashboard y worker, o usa el backup consistente descrito en [docs/OPERACION.md](docs/OPERACION.md). Conserva también `-wal` y `-shm` si existen. No subas estos archivos a Git. `DATABASE_URL` es una ruta de archivo, no una URL remota.

Licencia MIT. Consulta `REVIEW.md` para el resultado de la revisión inicial.
