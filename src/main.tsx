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
}
