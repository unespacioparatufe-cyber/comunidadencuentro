const CACHE_NAME = 'consejeros-encuentro-pwa-v18';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Escuchar mensajes desde chat-admin.html para disparar notificaciones nativas del sistema
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const title = event.data.title || 'Un nuevo mensaje';
    const chatId = event.data.chatId || '';
    const targetUrl = chatId ? `/chat-admin.html?chat=${encodeURIComponent(chatId)}` : '/chat-admin.html';
    const options = {
      body: event.data.body || 'Tienes un nuevo mensaje esperando respuesta.',
      icon: 'app-icon-192.png',
      badge: 'badge-notificacion.png',
      image: event.data.image || undefined,
      vibrate: [220, 110, 220, 110, 300],
      tag: event.data.tag || ('encuentro-chat-' + (chatId || 'general')),
      renotify: true,
      requireInteraction: true,
      silent: false, // Permite que el celular use el sonido de notificación nativo del teléfono si está activado
      data: { url: targetUrl, chatId }
    };
    event.waitUntil(self.registration.showNotification(title, options));
  }
});

// Soporte para eventos Push en segundo plano
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Un nuevo mensaje',
    body: 'Alguien acaba de escribir buscando orientación.',
    url: '/chat-admin.html',
    chatId: ''
  };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch (e) {
      payload.body = event.data.text();
    }
  }
  const targetUrl = payload.chatId
    ? `/chat-admin.html?chat=${encodeURIComponent(payload.chatId)}`
    : (payload.url || '/chat-admin.html');

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: 'app-icon-192.png',
      badge: 'badge-notificacion.png',
      vibrate: [250, 120, 250],
      tag: 'encuentro-push-' + (payload.chatId || 'general'),
      renotify: true,
      requireInteraction: true,
      silent: false,
      data: { url: targetUrl, chatId: payload.chatId || '' }
    })
  );
});

// Al tocar la notificación en el celular, abrir o enfocar la App y abrir directamente la conversación de esa persona
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const chatId = data.chatId || '';
  const targetUrl = data.url || (chatId ? `/chat-admin.html?chat=${encodeURIComponent(chatId)}` : '/chat-admin.html');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('chat-admin.html') && 'focus' in client) {
          client.postMessage({ type: 'OPEN_CHAT_FROM_NOTIFICATION', chatId });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
