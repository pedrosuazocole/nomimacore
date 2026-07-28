// =====================================================================
// sw.js — Service Worker de NominaCore HN
//
// Estrategia deliberada: "red primero" para TODO lo que sea navegacion
// o datos (planillas, empleados, reportes) — porque servir informacion
// de nomina desactualizada desde el cache seria peor que no tener
// nada. El cache SOLO se usa como respaldo si no hay internet, y para
// acelerar archivos estaticos que casi nunca cambian (css, iconos).
// =====================================================================
const CACHE_VERSION = 'nominacore-v2';
const ARCHIVOS_ESTATICOS = [
    '/css/estilos.css',
    '/img/icon-192.png?v=2',
    '/img/icon-512.png?v=2',
    '/offline.html'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => cache.addAll(ARCHIVOS_ESTATICOS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((nombres) =>
            Promise.all(nombres.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Nunca interceptar peticiones que no sean GET (formularios, POST de
    // marcar asistencia, guardar planilla, etc.) — esas SIEMPRE deben ir
    // directo a la red, nunca al cache.
    if (request.method !== 'GET') return;

    // Navegacion de paginas (entrar a /planillas, /reportes, etc.):
    // red primero, y si falla por falta de internet, se muestra la
    // pagina de respaldo — nunca una version vieja con datos incorrectos.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => caches.match('/offline.html'))
        );
        return;
    }

    // Archivos estaticos (css, imagenes, iconos): cache primero para que
    // carguen al instante, con la red como respaldo si no estan en cache.
    if (request.destination === 'style' || request.destination === 'image') {
        event.respondWith(
            caches.match(request).then((cacheada) => cacheada || fetch(request))
        );
        return;
    }

    // Cualquier otra cosa (llamadas a datos, APIs): siempre a la red.
});
