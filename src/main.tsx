import { render } from 'preact';
import './styles.css';
import { App } from './ui/App';
import { startSky } from './ui/sky';
import { archiveOldTrials, requestPersistence } from './data/db';

startSky(document.getElementById('sky') as HTMLCanvasElement);
render(<App />, document.getElementById('app')!);

void requestPersistence();
// keep the live table small; older trials move into gzip archives (nothing is dropped)
void archiveOldTrials(20000).catch(() => {});

if ('serviceWorker' in navigator && import.meta.env.PROD && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
} else if ('serviceWorker' in navigator && import.meta.env.DEV) {
  // `npm run serve` and the dev server share localhost:5173; keep the preview's worker out of dev
  navigator.serviceWorker
    .getRegistrations()
    .then((rs) => rs.forEach((r) => void r.unregister()))
    .catch(() => {});
}
