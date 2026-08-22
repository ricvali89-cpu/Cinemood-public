// Service worker per le notifiche push in background (app chiusa o in background)
importScripts("https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyC2N3Kt64HVWR5Quc6AF4BNEujt1qeKbL8",
  authDomain: "cinemood-c3215.firebaseapp.com",
  projectId: "cinemood-c3215",
  storageBucket: "cinemood-c3215.firebasestorage.app",
  messagingSenderId: "732937260760",
  appId: "1:732937260760:web:6621ff4cd1d5da9d80d1ad"
});

const messaging = firebase.messaging();

// Notifica mostrata quando l'app NON è in primo piano
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "CineMood";
  const options = {
    body: payload.notification?.body || "",
    icon: "/icon-192.png",
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});

// Al tap sulla notifica, apre (o porta in primo piano) il sito
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const tvId = event.notification.data?.tvId;
  const url = tvId ? `/?open=tv-${tvId}` : "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
