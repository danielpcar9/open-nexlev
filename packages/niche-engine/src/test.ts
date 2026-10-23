import { NicheFinderEngine } from './index.js';

async function runTest() {
  const engine = new NicheFinderEngine();
  console.log('🔍 Buscando canales emergentes en el nicho "stoicism"...');
  const results = await engine.discoverNicheChannels({
    query: 'stoicism',
    maxSubscribers: 50000,
    minOutlierScore: 2.5,
    minMedianViews: 3000,
    maxChannelsToAnalyze: 6,
  });

  console.log(`✅ Canales encontrados: ${results.length}`);
  console.log(JSON.stringify(results, null, 2));
}

runTest().catch((error) => { console.error(error); process.exitCode = 1; });
