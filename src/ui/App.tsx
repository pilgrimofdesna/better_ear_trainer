import { signal } from '@preact/signals';
import { Home } from './Home';
import { Trainer } from './Trainer';
import { Stats } from './Stats';
import { SettingsPage } from './SettingsPage';

export type Route = 'home' | 'single' | 'dictation' | 'stats' | 'settings';
export const route = signal<Route>('home');

export function go(r: Route) {
  route.value = r;
  scrollTo(0, 0);
}

export function App() {
  switch (route.value) {
    case 'single':
      return <Trainer exercise="single" />;
    case 'dictation':
      return <Trainer exercise="dictation" />;
    case 'stats':
      return <Stats />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <Home />;
  }
}
