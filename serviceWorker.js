// Use timestamp for automatic version updates
const VERSION_TIMESTAMP = new Date().getTime();
const CACHE_NAME = 'coderally-v16-' + VERSION_TIMESTAMP;

// Add query params to bust cache
const addVersionParam = (url) => {
  // Don't add version to external URLs or image files
  if (url.startsWith('http') || url.match(/\.(png|ico|svg)$/)) {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${VERSION_TIMESTAMP}`;
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

// Install event
self.addEventListener('install', (event) => {
  // Skip waiting to activate new service worker immediately
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event with offline support and cache refresh strategy
self.addEventListener('fetch', (event) => {
  const requestURL = new URL(event.request.url);
  
  // Special handling for HTML, CSS, and JS files - network-first approach
  if (requestURL.pathname.endsWith('.html') || 
      requestURL.pathname.endsWith('.css') || 
      requestURL.pathname.endsWith('.js') || 
      requestURL.pathname === '/' || 
      requestURL.pathname === '') {
    
    // Use a network-first strategy for key application resources
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          // Clone the response to cache it
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          // Fall back to cache if network fails
          return caches.match(event.request)
            .then(cachedResponse => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // If not in cache, try offline page for navigation
              if (event.request.mode === 'navigate') {
                return caches.match('./offline.html');
              }
              return new Response('Network error occurred', { status: 408 });
            });
        })
    );
  } else {
    // For other resources, use cache-first strategy
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            // Still fetch in the background to update cache
            fetch(event.request)
              .then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                  caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, networkResponse.clone());
                  });
                }
              })
              .catch(() => {/* ignore network errors */});
              
            return cachedResponse;
          }
          
          // Not in cache, fetch from network
          return fetch(event.request)
            .then(networkResponse => {
              if (networkResponse && networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, responseToCache);
                });
              }
              return networkResponse;
            })
            .catch(() => {
              // If both cache and network fail
              if (event.request.mode === 'navigate') {
                return caches.match('./offline.html');
              }
              return new Response('', {
                status: 408,
                statusText: 'Request timed out.'
              });
            });
        })
    );
  }
});

// Activate event with controlled cache cleanup
self.addEventListener('activate', (event) => {
  // Take control of all clients immediately
  self.clients.claim();
  
  // Only delete old caches, keep the current one
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      ).then(() => {
        // After clearing old caches, notify clients about the update
        return self.clients.matchAll().then(clients => {
          return Promise.all(clients.map(client => {
            // Send a message to each client that an update is available
            // but don't force refresh automatically
            return client.postMessage({
              type: 'UPDATE_AVAILABLE',
              timestamp: VERSION_TIMESTAMP
            });
          }));
        });
      });
    })
  );
});

// Message event handler
self.addEventListener('message', (event) => {
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
