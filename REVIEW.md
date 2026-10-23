# Revisión inicial — 23 de octubre de 2026

## Correcciones

- Imports inexistentes en las API de Next.js: ahora usan el paquete del workspace.
- Configuraciones TypeScript, Next.js, WXT y Drizzle; lockfile, gitignore, licencia MIT y CI.
- Actualización de Next.js, youtubei.js, WXT y Drizzle; eliminación de dependencias sin uso.
- Adaptación a `LockupView` en los videos de canal y al filtro de popularidad actual de youtubei.js.
- Filtros HTTP validados y límite de 20 canales por consulta; errores visibles en el dashboard.
- Se excluyen canales con suscriptores desconocidos para no tratarlos como canales pequeños.
- Corrección de unidades `mil`, decimales y separadores de miles en el motor.
- Extensión: evita reescribir badges idénticos y realimentar el MutationObserver, etiqueta la referencia de cuadrícula y evita división por cero en VPH.
- Extensión: consulta el documento del video actual para evitar subtítulos obsoletos tras navegar entre videos; rechaza respuestas vacías.
- El comando de prueba en vivo devuelve un código de salida de error si falla.

## Verificación

- TypeScript en los cuatro paquetes.
- Tres pruebas unitarias: métricas localizadas, mediana y timestamps.
- Compilación de producción de Next.js y extensión Chrome MV3.
- Dashboard HTTP 200 y HTTP 400 ante filtros fuera de rango, body nulo y video de tipo incorrecto.
- Handshake MCP y listado de las tres herramientas mediante el cliente oficial del SDK.
- YouTube en vivo: búsqueda devolvió 20 videos; análisis de un canal real devolvió 25 videos, suscriptores y mediana. Las métricas son una muestra puntual.

## Pendientes y límites

- No se verificó la interacción visual de la extensión dentro de Chrome ni la copia real al portapapeles.
- Resuelto: se sustituyó el recorrido de `getInfo/getTranscript` por metadatos del reproductor Android y pistas JSON3. Prueba real exitosa con dos videos; se conservan texto, conteo y timestamps.
- Resuelto: Swipe File conectado a Drizzle/SQLite, con importación de localStorage sin sobrescribir snapshots ya guardados.
- `npm audit` conserva cuatro avisos moderados en la cadena de herramientas de desarrollo de Drizzle/esbuild. No quedan avisos altos o críticos en el árbol instalado tras las actualizaciones. No equivale a una auditoría integral de seguridad.
- El código todavía utiliza adaptadores con `any` para algunas respuestas de YouTube y devuelve `null` cuando falla el análisis de canal. La extracción ahora devuelve errores tipados. Conviene añadir diagnósticos estructurados y fixtures para más formatos.
- React 18 compila, pero Next.js 16 avisa que su soporte está deprecado.

## Segunda revisión: transcripciones y persistencia

- Extractor compartido por motor, MCP y extensión; validación estricta de URLs y límite de tiempo.
- API de transcripciones devuelve 400/404/502/504 según el tipo de error.
- API Swipe File con validación, guardado idempotente, borrado e importación transaccional.
- SQLite con WAL y busy timeout; tabla aditiva, sin eliminar el esquema previo.
- Nueve pruebas automatizadas: métricas, URLs, JSON3, errores upstream y persistencia tras cerrar/reabrir la base.
- Validación final desde una instalación limpia con Node 22: TypeScript, nueve pruebas y builds de Next.js/Chrome MV3 completados.
- Prueba HTTP de guardado, importación idempotente, rechazo de datos inválidos, borrado y persistencia tras reiniciar el servidor: completada. Prueba real de transcripción por HTTP: completada.
- Prueba MCP real con timestamps y rechazo de URL inválida: completada.
- GitHub Actions no inició los jobs: la cuenta reportó un bloqueo de facturación. La validación anterior se ejecutó localmente.
