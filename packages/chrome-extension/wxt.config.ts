import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Open-NexLev — YouTube Outlier Detector & Script Extractor',
    description: 'Detecta videos outliers (multiplicador de vistas), VPH, descarga miniaturas HD y copia transcripciones limpias en 1 clic.',
    version: '1.0.0',
    permissions: ['clipboardWrite'],
    host_permissions: ['*://*.youtube.com/*'],
  },
});
