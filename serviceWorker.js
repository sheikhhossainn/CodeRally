const CACHE_NAME = 'coderally-v15';
const urlsToCache = [
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

// Fetch event with offline support
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version if available
        if (response) {
          return response;
        }
        
        // Otherwise try to fetch from network
        return fetch(event.request)
          .then((networkResponse) => {
            // If successful, clone and cache the response
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, responseToCache);
                });
            }
            return networkResponse;
          })
          .catch(() => {
            // If both cache and network fail, serve offline page for navigation requests
            if (event.request.mode === 'navigate') {
              return caches.match('./offline.html');
            }
            
            // Return nothing for other resource types (will show as failed in the network)
            return new Response('', {
              status: 408,
              statusText: 'Request timed out.'
            });
          });
      })
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  // Take control of all clients immediately
  self.clients.claim();
  
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
  );
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
