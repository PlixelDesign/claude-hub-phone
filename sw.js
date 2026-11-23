// Service worker do Claude Hub (celular): recebe os pushes do PC, mostra a notificação
// e envia Permitir/Negar de volta pelo canal de resposta (payload.r), sem abrir o app.
const VERSION = 'hub-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const ICON = new URL('icon-192.png', self.registration.scope).href;
const BADGE = new URL('badge-96.png', self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => { // rede primeiro; cai no cache se estiver sem internet
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const c = r.clone(); caches.open(VERSION).then((x) => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('index.html'))),
  );
});

const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

function build(d) {
  const base = { tag: d.id || 'hub', icon: ICON, badge: BADGE, data: d, timestamp: d.ts || Date.now(), lang: 'pt-BR' };
  if (d.k === 'perm') {
    return [`Claude quer usar ${d.tool}`, {
      ...base, body: `${d.project}\n${clip(d.cmd, 220)}`, requireInteraction: true, renotify: true, vibrate: [120, 60, 120],
      actions: [{ action: 'allow', title: 'Permitir' }, { action: 'deny', title: 'Negar' }],
    }];
  }
  if (d.k === 'stop') {
    return [`Terminou · ${d.project}`, {
      ...base, body: clip(d.last, 220) || (d.canReply ? 'Toque para responder ao Claude.' : 'O Claude terminou.'),
      requireInteraction: !!d.canReply, vibrate: [100],
      actions: d.canReply ? [{ action: 'reply', title: 'Responder' }] : [],
    }];
  }
  if (d.k === 'idle') {
    return [`Esperando você · ${d.project}`, { ...base, body: clip(d.msg, 220) || 'O Claude precisa de você.', vibrate: [100] }];
  }
  if (d.k === 'test') {
    return ['Claude Hub conectado ✔', { ...base, tag: 'hub-test', body: 'As notificações do seu PC vão aparecer aqui.' }];
  }
  return ['Claude Hub', { ...base, body: clip(d.msg, 220) }];
}

async function resolved(d) { // troca a notificação por um aviso silencioso e some em seguida
  await self.registration.showNotification(`Respondido${d.by ? ' · ' + d.by : ''}`, { tag: d.id, silent: true, icon: ICON, badge: BADGE, requireInteraction: false });
  await new Promise((r) => setTimeout(r, 2500));
  (await self.registration.getNotifications({ tag: d.id })).forEach((n) => n.close());
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { k: 'test' }; }
  if (d.k === 'resolved') return e.waitUntil(resolved(d));
  const [title, opts] = build(d);
  e.waitUntil(self.registration.showNotification(title, opts));
});

async function send(url, msg) {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(msg) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}
const b64 = (o) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function openApp(d) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of all) {
    if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.postMessage({ type: 'show', d }); return; }
  }
  await self.clients.openWindow(`${self.registration.scope}#/n/${b64(d)}`);
}

self.addEventListener('notificationclick', (e) => {
  const d = e.notification.data || {};
  e.notification.close();
  if ((e.action === 'allow' || e.action === 'deny') && d.r) {
    e.waitUntil(
      send(d.r, { t: 'decide', id: d.id, b: e.action }).catch(() =>
        self.registration.showNotification('Não consegui enviar a resposta', {
          tag: d.id, body: 'Verifique a internet e toque para tentar de novo.', icon: ICON, badge: BADGE, data: d,
        })),
    );
    return;
  }
  e.waitUntil(openApp(d));
});
