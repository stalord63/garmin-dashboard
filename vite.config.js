import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// On `npm run dev`, pull fresh Garmin data in the background (scripts/fetch-garmin.mjs),
// then reload any open dashboard tab when public/garmin.json has been rewritten.
// Set GARMIN_SKIP_FETCH=1 to start without fetching.
function garminFetchOnStart() {
  return {
    name: 'garmin-fetch-on-start',
    apply: 'serve',
    configureServer(server) {
      if (process.env.GARMIN_SKIP_FETCH === '1') return;
      const log = server.config.logger;
      server.httpServer?.once('listening', () => {
        log.info('[garmin] fetching latest data from the Garmin API…', { timestamp: true });
        const script = fileURLToPath(new URL('./scripts/fetch-garmin.mjs', import.meta.url));
        const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
        const relay = (level) => (chunk) => String(chunk).split(/\r?\n/).filter(Boolean)
          .forEach((line) => log[level](`[garmin] ${line}`, { timestamp: true }));
        child.stdout.on('data', relay('info'));
        child.stderr.on('data', relay('warn'));
        child.on('close', (code) => {
          if (code === 0) {
            log.info('[garmin] done, reloading the dashboard', { timestamp: true });
            server.ws.send({ type: 'full-reload' });
          } else {
            log.warn('[garmin] fetch failed; showing the last saved public/garmin.json', { timestamp: true });
          }
        });
        server.httpServer.once('close', () => child.kill());
      });
    },
  };
}

export default defineConfig({ plugins: [react(), garminFetchOnStart()] });
