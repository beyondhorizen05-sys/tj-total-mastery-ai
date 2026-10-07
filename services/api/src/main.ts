import { loadConfig } from './config.js';
import { createServer } from './server/app.js';

const config = loadConfig();

async function main() {
  const { app } = await createServer(config);

  try {
    const address = await app.listen({ host: config.host, port: config.port });
    console.log(`\n🤖 TJ — Total Mastery AI v${config.version}`);
    console.log(`🚀 API Server running at: ${address}`);
    console.log(`📦 Data directory: ${config.dataDir}`);
    console.log(`🔌 Stop All killswitch: POST /api/v1/system/stop-all\n`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();
