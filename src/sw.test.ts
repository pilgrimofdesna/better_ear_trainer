import { describe, expect, it } from 'vitest';
import swSource from '../public/sw.js?raw';

// Runs the real public/sw.js against an in-memory Cache Storage and a fake server.
const ORIGIN = 'http://localhost:5173';
const BUILT_HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="./assets/index-D_8RSEDu.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-CKtBbPvJ.css">
</head><body><canvas id="sky"></canvas><div id="app"></div></body></html>`;
const DEV_HTML = `<!doctype html><html><head><script type="module" src="/@vite/client"></script></head>
<body><div id="app"></div><script type="module" src="/src/main.tsx"></script></body></html>`;

type Page = { status?: number; body: string };

function worker(server: Record<string, Page>, stores = new Map<string, Map<string, Response>>()) {
  const handlers: Record<string, (e: any) => void> = {};
  const state = { online: true, net: [] as string[] };
  const abs = (u: any) => new URL(typeof u === 'string' ? u : u.url, `${ORIGIN}/sw.js`).href;
  const fetchMock = async (input: any): Promise<Response> => {
    const url = new URL(abs(input));
    state.net.push(url.pathname + url.search);
    if (!state.online) throw new TypeError('Failed to fetch');
    const page = server[url.pathname];
    return page ? new Response(page.body, { status: page.status ?? 200 }) : new Response('not found', { status: 404 });
  };
  const store = (name: string) => {
    let m = stores.get(name);
    if (!m) stores.set(name, (m = new Map()));
    return m;
  };
  const caches = {
    async open(name: string) {
      const m = store(name);
      return {
        match: async (req: any) => m.get(abs(req))?.clone(),
        put: async (req: any, res: Response) => void m.set(abs(req), res),
        async addAll(urls: string[]) {
          const rs = await Promise.all(urls.map(fetchMock));
          if (rs.some((r) => !r.ok)) throw new TypeError('addAll: bad status');
          rs.forEach((r, i) => m.set(abs(urls[i]), r));
        },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    async match(req: any) {
      for (const m of stores.values()) {
        const r = m.get(abs(req));
        if (r) return r.clone();
      }
      return undefined;
    },
  };
  const self = {
    addEventListener: (type: string, fn: (e: any) => void) => void (handlers[type] = fn),
    skipWaiting() {},
    clients: { claim() {} },
  };
  new Function('self', 'caches', 'fetch', 'location', swSource)(self, caches, fetchMock, new URL(`${ORIGIN}/sw.js`));

  async function dispatch(type: string, extra: object = {}) {
    const waits: Promise<unknown>[] = [];
    let responded = null as Promise<Response> | null; // set from the handler
    handlers[type]({
      ...extra,
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
      respondWith: (p: Promise<Response>) => void (responded = Promise.resolve(p)),
    });
    const res: Response | null = responded ? await responded : null;
    for (let i = 0; i < waits.length; i++) await waits[i]; // waitUntil may be called while responding
    return res;
  }
  const req = (path: string, mode = 'cors') => ({ request: { url: ORIGIN + path, method: 'GET', mode } });
  const cached = (name = 'stellar-ear-v2') => [...(stores.get(name)?.keys() ?? [])].map((u) => new URL(u).pathname).sort();
  return {
    state,
    stores,
    cached,
    install: () => dispatch('install'),
    activate: () => dispatch('activate'),
    get: (path: string) => dispatch('fetch', req(path)),
    navigate: (path = '/') => dispatch('fetch', req(path, 'navigate')),
  };
}

const prodServer = (): Record<string, Page> => ({
  '/': { body: BUILT_HTML },
  '/index.html': { body: BUILT_HTML },
  '/assets/index-D_8RSEDu.js': { body: 'js v1' },
  '/assets/index-CKtBbPvJ.css': { body: 'css v1' },
  '/manifest.webmanifest': { body: '{}' },
  '/icon.svg': { body: '<svg/>' },
});

describe('service worker', () => {
  it('precaches the hashed bundle at install, so the first visit already works offline', async () => {
    const sw = worker(prodServer());
    await sw.install();
    await sw.activate();
    expect(sw.cached()).toEqual([
      '/assets/index-CKtBbPvJ.css',
      '/assets/index-D_8RSEDu.js',
      '/icon.svg',
      '/index.html',
      '/manifest.webmanifest',
    ]);
    sw.state.online = false;
    expect(await (await sw.navigate('/'))!.text()).toBe(BUILT_HTML);
    expect(await (await sw.get('/assets/index-D_8RSEDu.js'))!.text()).toBe('js v1');
    expect(await (await sw.get('/assets/index-CKtBbPvJ.css'))!.text()).toBe('css v1');
    expect((await sw.get('/manifest.webmanifest'))!.ok).toBe(true);
  });

  it('drops the old cache on activate', async () => {
    const stores = new Map([['stellar-ear-v1', new Map([[`${ORIGIN}/src/main.tsx`, new Response('stale')]])]]);
    const sw = worker(prodServer(), stores);
    await sw.install();
    await sw.activate();
    expect([...stores.keys()]).toEqual(['stellar-ear-v2']);
  });

  it('never answers dev-server module requests from the cache', async () => {
    const server = { ...prodServer(), '/index.html': { body: DEV_HTML }, '/': { body: DEV_HTML } };
    const sw = worker(server);
    await sw.install(); // a changed sw.js installs while the dev server is running
    await sw.activate();
    for (const path of ['/src/main.tsx', '/src/ui/App.tsx?t=123', '/@vite/client', '/node_modules/.vite/deps/preact.js?v=1', '/@fs/x.ts']) {
      expect(await sw.get(path)).toBeNull(); // not intercepted: straight to the network
    }
    // the dev page itself is not kept as the offline index.html
    expect(await sw.navigate('/')).not.toBeNull();
    expect(sw.cached()).toEqual(['/icon.svg', '/manifest.webmanifest']);
  });

  it('serves hashed assets cache first and never keeps an error response', async () => {
    const server = prodServer();
    const sw = worker(server);
    await sw.install();
    await sw.activate();
    sw.state.net.length = 0;
    // a new build's asset: fetched once, then from the cache
    server['/assets/next-abc.js'] = { body: 'next' };
    expect(await (await sw.get('/assets/next-abc.js'))!.text()).toBe('next');
    server['/assets/next-abc.js'] = { body: 'changed' };
    expect(await (await sw.get('/assets/next-abc.js'))!.text()).toBe('next');
    expect(sw.state.net).toEqual(['/assets/next-abc.js']);
    // a 404 is passed through but not stored
    expect((await sw.get('/assets/late.js'))!.status).toBe(404);
    server['/assets/late.js'] = { body: 'late' };
    expect(await (await sw.get('/assets/late.js'))!.text()).toBe('late');
  });

  it('keeps the latest good index.html for offline use, never an error page', async () => {
    const server = prodServer();
    const sw = worker(server);
    await sw.install();
    await sw.activate();
    // a new deploy: the navigation stores the new page and the files it names
    const NEXT = BUILT_HTML.replace('index-D_8RSEDu.js', 'index-NEW.js');
    server['/'] = { body: NEXT };
    server['/assets/index-NEW.js'] = { body: 'js v2' };
    expect(await (await sw.navigate('/'))!.text()).toBe(NEXT);
    expect(sw.cached()).toContain('/assets/index-NEW.js');
    // a server error is shown but does not replace the offline copy
    server['/'] = { status: 500, body: 'boom' };
    expect((await sw.navigate('/'))!.status).toBe(500);
    sw.state.online = false;
    expect(await (await sw.navigate('/'))!.text()).toBe(NEXT);
    expect(await (await sw.get('/assets/index-NEW.js'))!.text()).toBe('js v2');
  });
});
