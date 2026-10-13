import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../server.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const external = process.env.HEADLINE_DETECTIVE_ENV_FILE;
const envFile = external ? path.resolve(external) : path.join(root, '.env');
if (existsSync(envFile)) {
  try { process.loadEnvFile(envFile); }
  catch { console.error('Could not read the local provider settings. Check the file format and permissions.'); process.exit(1); }
} else if (external) {
  console.error('The specified private settings file was not found.'); process.exit(1);
}
const app = createGameServer();
app.listen().then(address => console.log('Headline Detective: http://' + address.address + ':' + address.port))
  .catch(() => { console.error('Could not start the local game. Check whether the port is already in use.'); process.exitCode = 1; });
