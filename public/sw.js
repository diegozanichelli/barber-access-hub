/*
 * Service worker do Caixa Grupo Roots.
 *
 * Existe só para receber lembretes de fechamento de caixa. Não faz cache de
 * nada: um app de caixa não pode servir tela velha com saldo desatualizado.
 *
 * Precisa ficar em /sw.js (raiz), senão o escopo do push não cobre o app.
 */

self.addEventListener("install", () => {
  // Assume o controle sem esperar o usuário fechar todas as abas.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Push sem corpo, ou corpo que não é JSON: ainda vale avisar.
    payload = {};
  }

  const title = payload.title || "Caixa Grupo Roots";
  const options = {
    body: payload.body || "Há um caixa aberto aguardando fechamento.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    // Uma tag por turno faz o aviso novo substituir o anterior em vez de
    // empilhar três notificações do mesmo caixa.
    tag: payload.tag || "shift-reminder",
    renotify: true,
    requireInteraction: true,
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Se o app já está aberto em alguma aba, foca nela em vez de abrir outra.
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});
