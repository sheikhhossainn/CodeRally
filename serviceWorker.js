// Use fixed version string to enable proper update detection
const VERSION = '20250729-4'; // Increment version
const TIMESTAMP = new Date().getTime(); // Add timestamp for extra freshness
const CACHE_NAME = 'coderally-' + VERSION;
const CACHE_MAX_AGE = 3600 * 1000; // 1 hour max cache age

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

// Install event with guaranteed skipWaiting
self.addEventListener('install', (event) => {
  console.log('Service Worker installing with version:', VERSION);
  
  // Clear ALL old caches first before installing
  event.waitUntil(
    // Delete ALL existing caches first
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache during install:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => caches.open(CACHE_NAME))
    .then((cache) => {
      console.log('Creating new cache:', CACHE_NAME);
      return cache.addAll(urlsToCache);
    })
    .then(() => {
      // This forces the waiting service worker to become active immediately
      console.log('Skipping waiting state');
      return self.skipWaiting();
    })
  );
});

// Fetch event with offline support and cache refresh strategy
self.addEventListener('fetch', (event) => {
  const requestURL = new URL(event.request.url);
  
  // Special handling for HTML, CSS, and JS files - ALWAYS network-first approach
  if (requestURL.pathname.endsWith('.html') || 
      requestURL.pathname.endsWith('.css') || 
      requestURL.pathname.endsWith('.js') || 
      requestURL.pathname === '/' || 
      requestURL.pathname === '') {
    
    // Always try network first for core files, ignore cache completely for HTML
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            // Only cache good responses
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              // Add to new cache
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Fall back to cache ONLY if network fails
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
    // For other resources, use stale-while-revalidate strategy
    event.respondWith(
      // Check cache first, then network
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          // Always fetch a fresh version from the network
          const fetchPromise = fetch(event.request).then(networkResponse => {
            // Only cache successful responses
            if (networkResponse && networkResponse.status === 200) {
              // Update the cache with the new version
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(error => {
            console.log('Network fetch failed, returning cached or offline content', error);
            // If network fails and we're navigating, try offline page
            if (event.request.mode === 'navigate') {
              return caches.match('./offline.html');
            }
            // For non-navigation requests, throw to trigger cached response
            throw error;
          });
          
          // Return the cached response if we have it, otherwise wait for the network
          return cachedResponse || fetchPromise;
        });
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
      })
    );
  }
});

// Activate event with immediate and aggressive client refresh
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating with version:', VERSION);
  
  // Delete all caches first regardless of name to ensure clean state
  event.waitUntil(
    // Aggressively delete ALL caches, regardless of name
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting cache during activation:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      // Take immediate control of all clients
      console.log('Taking control of all clients');
      return self.clients.claim();
    })
    .then(() => {
      // Force reload ALL clients after taking control
      console.log('Forcing refresh of all clients');
      return self.clients.matchAll().then(clients => {
        if (clients && clients.length) {
          console.log(`Refreshing ${clients.length} client(s)`);
          
          // For each client
          return Promise.all(clients.map(client => {
            console.log(`Navigating client to: ${client.url}`);
            // Force hard reload
            return client.navigate(client.url).catch(err => {
              console.error('Client navigation failed:', err);
              // As backup, try posting a refresh message
              return client.postMessage({
                type: 'FORCE_REFRESH',
                timestamp: Date.now()
              });
            });
          }));
        }
      });
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
