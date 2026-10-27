# Operación local

Open-NexLev sigue siendo una herramienta local. No hay cuentas ni despliegue público en este MVP.

## Procesos

Desde la raíz, con Node 22:

```sh
nvm use
npm ci
npm run dev:dashboard   # http://127.0.0.1:3000
npm run worker          # obligatorio para capturas y búsquedas automáticas
```

`npm run worker` también puede lanzarse desde otro directorio: la base relativa se resuelve siempre contra `packages/web-dashboard`. Sin el worker, el panel dice «actualización automática detenida». Apagar el equipo detiene el seguimiento; no se recuperan las capturas perdidas, solo se encola una foto actual por canal vencido.

El worker atiende como máximo dos solicitudes concurrentes al proveedor (`PROVIDER_CONCURRENCY`, 1–4, por defecto 2). Cierra con SIGINT o SIGTERM: deja de reclamar trabajos y espera la petición ya iniciada hasta el siguiente punto de control. Una cancelación confirmada antes de guardar no se publica como éxito. Una petición HTTP ya empezada no se aborta a mitad de la respuesta de YouTube.

## Qué es observado y qué es estimado

- Una ventana de 24 h, 7 d o 30 d compara dos observaciones del mismo proveedor. Si no hay un punto a ±3 h del inicio, la cobertura es insuficiente. Siete días no se presentan como 24 h.
- Si la última observación tiene más de 12 h, el estado es desactualizado.
- Un contador abreviado («1.2M») sigue siendo redondeado. Un fallo o un campo ausente es desconocido, no cero.
- Si el contador baja, es una corrección o reinicio. No se recorta a cero ni genera una alerta de crecimiento.
- Sin un mes observado se puede mostrar una proyección (`delta / días × 30`). Lleva la etiqueta de proyección y el periodo fuente.
- El total del canal no es la suma de los 25 videos inspeccionados. Si el proveedor no lo entrega, queda vacío.
- Los ingresos son escenarios con un RPM supuesto en USD: por publicación, por vistas observadas o proyección mensual. Una mezcla desconocida de Shorts y videos largos desactiva el cálculo automático.

## Alertas

La primera captura marca outliers ya visibles como hallazgos iniciales. Después solo se avisa el cruce del umbral (3× por defecto, mínimo 10 videos comparables de formato conocido). La aceleración pide dos semanas comparables, +100% y al menos 1.000 vistas; no se dispara con una base de cero ni con un delta menor que la resolución de un contador redondeado. Tres fallos seguidos crean una alerta operativa y se resuelve con una captura buena. Los reintentos no duplican la alerta.

## Investigación y score v1

Las consultas de referentes y de competencia se guardan tal como se escriben. El rol, las etiquetas, las notas y el idioma corregido a mano prevalecen. Una búsqueda fallida deja el componente de competencia como desconocido: no significa que no haya competencia.

El score es una heurística versionada (`v1`), no una probabilidad de éxito. Hacen falta cinco investigaciones completas y comparables (mismas consultas, presupuesto, filtros y frescura) para percentiles. El percentil usa el rango medio de los empates: se ordena de menor a mayor, el rango es la posición 1-based media y el percentil es `(rango - 1) / (n - 1) × 100`. La competencia usa el percentil inverso. Si falta un componente no vale 0 ni 100. Con menos del 70% del peso disponible el resultado es «datos insuficientes». Los pesos enteros deben sumar 100.

## Retención y YouTube Data API

Por defecto las observaciones de Innertube se conservan 35 días (`OBSERVATION_RETENTION_DAYS`). Ese número no es una promesa sobre las políticas de terceros. El mantenimiento recorre todas las series, también las de canales en pausa.

YouTube Data API queda desactivada hasta definir `YOUTUBE_API_KEY` y `YOUTUBE_API_STORAGE_ACK=30-days`. Antes de activarla hay que leer la política vigente de los [YouTube API Services](https://developers.google.com/youtube/terms/developer-policies). Este código, al activarse, borra estadísticas de ese proveedor a los 30 días y no permite alargarlas con la variable de Innertube. La clave no se escribe en los logs. Una captura de canal cuesta una llamada `channels.list` (los IDs se agrupan de hasta 50), más `playlistItems` y `videos.list` en grupos de 50.

## Copia de seguridad

No copies solo el `.db` mientras el dashboard o el worker escriben. Detén ambos procesos y conserva `.db`, `-wal` y `-shm`, o haz una copia consistente:

```sh
sqlite3 packages/web-dashboard/open-nexlev.db ".backup 'open-nexlev-backup.db'"
```

Para restaurar, detén los procesos y sustituye el archivo. `npm run db:migrate` aplica migraciones versionadas e idempotentes; no usa `drizzle-kit push` al arrancar y no borra `saved_channels`.

## Pruebas

```sh
npm test                 # sin red
npm run test:integration # worker y reinicio, sin red
npm run typecheck
npm run build
npm run test:engine      # YouTube en vivo; no forma parte de CI
```

GitHub Actions puede no arrancar si la cuenta tiene la facturación bloqueada. Eso no es un fallo de estas pruebas: hay que ejecutarlas en local y no marcar CI como verde solo por el bloqueo.

Los fixtures de las pruebas son inventados y no se muestran como resultados de YouTube.
