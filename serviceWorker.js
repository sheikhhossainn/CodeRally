// Use fixed version string to enable proper update detection
const VERSION = '20250729-6'; // Increment version
const CACHE_NAME = 'coderally-' + VERSION;

// Add query params to bust cache
const addVersionParam = (url) => {
  // Don't add version to external URLs or image files
  if (url.startsWith('http') || url.match(/\.(png|ico|svg)$/)) {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${VERSION}`;
};

const resourcesToPrecache = [
  './',
  './index.html',
  './problems.html',
  './offline.html',
  './styles.css',
  './problems-styles.css',
  './script.js',
  './manifest.json',
  './icon-1024.ico',
  './icon-512.ico',
  './icon-192.ico',
  './icon-1024.png',
  './icon-512.png',
  './icon-192.png'
];

// Apply cache busting to each URL
const urlsToCache = resourcesToPrecache.map(url => addVersionParam(url));

// Install event - clean and simple
self.addEventListener('install', (event) => {
  console.log('Service Worker installing with version:', VERSION);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Creating cache:', CACHE_NAME);
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('Service Worker installed successfully');
        // Skip waiting to activate immediately
        return self.skipWaiting();
      })
  );
});

// Fetch event with simple network-first strategy
self.addEventListener('fetch', (event) => {
  const requestURL = new URL(event.request.url);
  
  // For HTML, CSS, and JS files - always try network first
  if (requestURL.pathname.endsWith('.html') || 
      requestURL.pathname.endsWith('.css') || 
      requestURL.pathname.endsWith('.js') || 
      requestURL.pathname === '/' || 
      requestURL.pathname === '') {
    
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          // Cache the response if it's successful
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(event.request)
            .then(cachedResponse => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // If not in cache and it's a navigation request, show offline page
              if (event.request.mode === 'navigate') {
                return caches.match('./offline.html');
              }
              return new Response('Network error', { status: 408 });
            });
        })
    );
  } else {
    // For other resources (images, etc.) - cache first
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          return cachedResponse || fetch(event.request)
            .then(networkResponse => {
              if (networkResponse && networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, responseToCache);
                });
              }
              return networkResponse;
            });
        })
        .catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('./offline.html');
          }
          return new Response('Network error', { status: 408 });
        })
    );
  }
});

// Activate event - clean up old caches without forcing refresh
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating with version:', VERSION);
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      console.log('Service Worker activated, taking control');
      return self.clients.claim();
    })
  );
});

// Message event handler
self.addEventListener('message', (event) => {
  // Handle cache clearing
  if (event.data && event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys()
        .then(cacheNames => {
          return Promise.all(
            cacheNames.map(cacheName => {
              console.log('Service worker deleting cache:', cacheName);
              return caches.delete(cacheName);
            })
          );
        })
        .then(() => {
          // Respond to confirm caches were cleared
          if (event.source) {
            event.source.postMessage({
              type: 'CACHES_CLEARED',
              timestamp: new Date().getTime()
            });
          }
        })
    );
  }
  
  // Handle check version messages
  if (event.data && event.data.type === 'CHECK_VERSION') {
    // Reply with current service worker version
    if (event.source) {
      event.source.postMessage({
        type: 'CURRENT_VERSION',
        version: VERSION,
        timestamp: Date.now()
      });
    }
  }
});

// Push event handler
self.addEventListener('push', (event) => {
  try {
    // Try to parse the notification data with error handling
    let data = {};
    
    if (event.data) {
      try {
        // First try to use the json method if available
        if (typeof event.data.json === 'function') {
          data = event.data.json();
        } 
        // Fallback to text and manual parsing
        else {
          data = JSON.parse(event.data.text());
        }
      } catch (e) {
        console.error('Error parsing notification data:', e);
        // Set default data if parsing fails
        data = {
          title: 'CodeRally Update',
          body: 'There is new activity in CodeRally!'
        };
      }
    }
    
    const title = data.title || 'CodeRally Contest Alert';
    const options = {
      body: data.body || 'A programming contest is starting soon!',
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [100, 50, 100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: data.id || '1',
        url: data.url || '/'
      },
      actions: [
        {
          action: 'open',
          title: 'View Contest'
        }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } catch (error) {
    console.error('Push notification error:', error);
    
    // Show a generic notification as fallback
    event.waitUntil(
      self.registration.showNotification('CodeRally', {
        body: 'Something new is happening on CodeRally!',
        icon: './icon-192.png'
      })
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  try {
    // Always close the notification when clicked
    event.notification.close();

    // Safe access to notification data
    const notificationData = event.notification.data || {};
    const targetUrl = notificationData.url || '/';

    // Handle action buttons
    if (event.action === 'open' || event.action === 'participate' || event.action === 'view') {
      event.waitUntil(
        clients.openWindow(targetUrl)
          .catch(error => {
            console.error('Error opening window:', error);
            return clients.openWindow('/');
          })
      );
      return;
    }
    
    // Default click behavior (clicking on the notification body)
    event.waitUntil(
      clients.matchAll({type: 'window'})
        .then(windowClients => {
          // If we have open windows
          if (windowClients.length > 0) {
            // Try to focus an existing window
            for (const client of windowClients) {
              if ('focus' in client) {
                client.focus();
                // Navigate if needed and possible
                if (client.url !== targetUrl && 'navigate' in client) {
                  return client.navigate(targetUrl);
                }
                return;
              }
            }
          }
          
          // If no suitable window exists, open one
          return clients.openWindow(targetUrl);
        })
        .catch(error => {
          console.error('Error handling notification click:', error);
          // Fallback - open homepage
          return clients.openWindow('/');
        })
    );
  } catch (error) {
    console.error('Notification click error:', error);
    // Final fallback
    event.waitUntil(clients.openWindow('/'));
  }
});
