import path from 'node:path';
import { loadConfig, loadEnvFile } from './config.ts';
import { createApp } from './app.ts';

loadEnvFile(path.resolve('.env'));
loadEnvFile(path.resolve('..', '.env'));

const config = loadConfig();
const app = await createApp(config);

app.server.listen(config.port, config.host, () => {
  console.log(`Remote gateway listening on http://${config.host}:${config.port}`);
  if (app.pairingCode) {
    console.log(`Pairing code: ${app.pairingCode}`);
    console.log('Enter this code in the app. It is not shown again in the browser.');
  } else {
    console.warn(
      'Pairing code file is missing or does not match the saved code. Set PAIRING_CODE to issue a new one.',
    );
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
