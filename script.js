const contestList = document.getElementById('contestList');

// Cache for storing contest data
let contestsCache = null;
let lastFetchTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Current filter state
let currentFilter = 'upcoming';
let currentDifficulty = 'easy'; // Add difficulty filter state

// Service worker registration for push notifications
let swRegistration = null;

// Variables for update detection
let updateAvailable = false;
let refreshingPage = false;
let forceRefreshAttempted = false;

// Track refresh state in sessionStorage to prevent infinite refresh loops
function isRefreshCycling() {
    const refreshCount = parseInt(sessionStorage.getItem('refreshCount') || '0');
    const lastRefreshTime = parseInt(sessionStorage.getItem('lastRefreshTime') || '0');
    const currentTime = new Date().getTime();
    
    // If we've refreshed more than 2 times in the last 10 seconds, it's probably cycling
    return refreshCount > 2 && (currentTime - lastRefreshTime < 10000);
}

// Function to perform a hard refresh that bypasses caches
function hardRefresh() {
    // Prevent refresh cycles
    if (isRefreshCycling()) {
        console.warn('Detected refresh cycling, stopping the cycle');
        sessionStorage.removeItem('refreshCount');
        sessionStorage.removeItem('lastRefreshTime');
        
        // Show a manual refresh button instead of auto-refreshing
        const toast = document.createElement('div');
        toast.style.position = 'fixed';
        toast.style.top = '0';
        toast.style.left = '0';
        toast.style.right = '0';
        toast.style.backgroundColor = '#ff4500';
        toast.style.color = 'white';
        toast.style.padding = '10px';
        toast.style.textAlign = 'center';
        toast.style.zIndex = '9999';
        toast.innerHTML = 'We detected an update loop. <button onclick="location.reload(true)" style="background: white; color: #ff4500; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Click here</button> to manually update when ready.';
        document.body.appendChild(toast);
        return;
    }
    
    // Track refresh attempt
    const refreshCount = parseInt(sessionStorage.getItem('refreshCount') || '0');
    sessionStorage.setItem('refreshCount', refreshCount + 1);
    sessionStorage.setItem('lastRefreshTime', new Date().getTime());
    
    console.log('Performing hard refresh...');
    
    // Mark that we're handling an update
    localStorage.setItem('handlingUpdate', 'true');
    
    // Clear localStorage cache
    localStorage.removeItem('contestsCache');
    localStorage.removeItem('lastFetchTime');
    
    // Request cache clearance from service worker
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'CLEAR_CACHES'
        });
    }
    
    // Allow time for cache clearing to complete
    setTimeout(() => {
        // Standard reload with cache bypass
        window.location.reload(true);
    }, 500);
}

// Function to get display limit based on screen size
function getDisplayLimit() {
    return window.innerWidth <= 768 ? 4 : 8; // 4 for mobile, 8 for desktop
}

// Initial number of contests to show
let displayLimit = getDisplayLimit();

// Set up event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    const filterButtons = document.querySelectorAll('#upcoming, #ongoing, #finished');
    const platformButtons = document.querySelectorAll('#codeforces, #hackerrank, #codechef');
    const difficultyButtons = document.querySelectorAll('#easy, #medium, #hard');
    const installBtn = document.getElementById('installBtn');
    const notificationBtn = document.getElementById('notificationBtn');
    
    // Initialize notification settings if first time visit
    if (localStorage.getItem('notificationsEnabled') === null) {
        localStorage.setItem('notificationsEnabled', 'false');
        localStorage.setItem('firstRun', 'true');
    }
    
    // Initialize notification button state
    updateNotificationButtonState();
    
    // Contest filter buttons
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Remove active class from all filter buttons
            filterButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            this.classList.add('active');
            
            // Set current filter
            currentFilter = this.id;
            
            // Reset display limit when changing filter
            displayLimit = getDisplayLimit();
            
            // Display filtered contests
            if (contestsCache) {
                displayContests(contestsCache);
            }
        });
    });
    

    platformButtons.forEach(button => {
        button.addEventListener('click', function() {
            
            platformButtons.forEach(btn => btn.classList.remove('active'));
            
            this.classList.add('active');
            
           
            if (this.id === 'codeforces') {
                fetchData();
            } else {
                contestList.innerHTML = `<li style="text-align: center; padding: 20px; color: #888;">${this.textContent} contests coming soon!</li>`;
            }
        });
    });
    

    difficultyButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Remove active class from all difficulty buttons
            difficultyButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            this.classList.add('active');
            
            // Set current difficulty filter
            currentDifficulty = this.id;
            
            // Reset display limit when changing difficulty
            displayLimit = getDisplayLimit();
            
            // Display filtered contests
            if (contestsCache) {
                displayContests(contestsCache);
            }
        });
    });
    
    // PWA Install button
    let deferredPrompt;
    let isPWAInstallable = false;
    
    // Check if app is already installed on load
    function checkIfInstalled() {
        // Check if running in standalone mode (already installed)
        if (window.matchMedia('(display-mode: standalone)').matches || 
            window.navigator.standalone === true) {
            installBtn.innerHTML = '<span class="install-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>';
            installBtn.title = 'App Installed';
            installBtn.disabled = true;
            return true;
        }
        return false;
    }
    
    // Check on page load
    if (!checkIfInstalled()) {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            isPWAInstallable = true;
            installBtn.innerHTML = '<span class="install-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg></span>';
            installBtn.title = 'Install App';
        });
    }
    
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt && isPWAInstallable) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                installBtn.innerHTML = '<span class="install-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>';
                installBtn.title = 'App Installed';
                installBtn.disabled = true;
            }
            deferredPrompt = null;
        } else {
            // Detect device type and show appropriate instructions
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const isAndroid = /Android/.test(navigator.userAgent);
            
            let message = 'To install this app:\n\n';
            
            if (isIOS) {
                message += '📱 On iPhone/iPad:\n';
                message += '1. Tap the Share button (⬆️)\n';
                message += '2. Scroll down and tap "Add to Home Screen"\n';
                message += '3. Tap "Add" to confirm';
            } else if (isAndroid) {
                message += '📱 On Android:\n';
                message += '1. Tap the menu (⋮) in your browser\n';
                message += '2. Look for "Add to Home Screen" or "Install app"\n';
                message += '3. Tap "Install" or "Add"';
            } else {
                message += '💻 On Desktop:\n';
                message += '• Chrome: Click the install icon in the address bar\n';
                message += '• Firefox: Add to home screen from browser menu\n';
                message += '• Edge: Click the install icon or use browser menu';
            }
            
            alert(message);
        }
    });
    
    // Check if app is already installed
    window.addEventListener('appinstalled', () => {
        installBtn.innerHTML = '<span class="install-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>';
        installBtn.title = 'App Installed';
        installBtn.disabled = true;
    });
    
    // Periodic check for installation status (for mobile)
    setInterval(() => {
        if (!installBtn.disabled) {
            checkIfInstalled();
        }
    }, 2000);
    
    // Notification button functionality
    notificationBtn.addEventListener('click', async (event) => {
        // Prevent default to avoid any form submission
        event.preventDefault();
        
    // Don't process if already processing a click
    if (notificationBtn.dataset.processing === 'true') {
        return;
    }
    
    // Set processing flag to prevent multiple clicks
    notificationBtn.dataset.processing = 'true';
    
    try {
        // Add a visual cue that the button was clicked
        notificationBtn.classList.add('clicked');
        
        // Get current state before toggling
        const currentState = localStorage.getItem('notificationsEnabled') === 'true';            // Toggle the notifications state
            await toggleNotifications();
            
            // Force a complete refresh of the button state
            updateNotificationButtonState();
        } catch (error) {
            // Make sure we reset the button state on error
            updateNotificationButtonState();
        } finally {
            // Always make sure we reset the processing state
            setTimeout(() => {
                notificationBtn.classList.remove('clicked');
                notificationBtn.dataset.processing = 'false';
            }, 300);
        }
    });
    
    // Initialize notification button state
    updateNotificationButtonState();
    
    // Force refresh after a small delay to ensure button state is correctly displayed
    setTimeout(() => {
        refreshNotificationButton();
    }, 100);
    
    // Add smooth scrolling for the Track Contests button
    const trackContestsBtn = document.getElementById('trackContestsBtn');
    if (trackContestsBtn) {
        trackContestsBtn.addEventListener('click', function(e) {
            e.preventDefault();
            const contestsSection = document.getElementById('contests');
            if (contestsSection) {
                contestsSection.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }
    
    // Set default active states
    document.getElementById('codeforces').classList.add('active');
    document.getElementById('easy').classList.add('active');
    document.getElementById('upcoming').classList.add('active');
    
    // Initial load
    fetchData();
});

// Register Service Worker for PWA with controlled update and push support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            // Check if we're handling an update that was initiated before
            const handlingUpdate = localStorage.getItem('handlingUpdate') === 'true';
            if (handlingUpdate) {
                // Clear the flag since we've now reloaded
                localStorage.removeItem('handlingUpdate');
                console.log('Update completed successfully');
            }
            
            // Register service worker with simple approach
            const SW_VERSION = '20250729-7'; // Match with service worker VERSION
            const registration = await navigator.serviceWorker.register('./serviceWorker.js?v=' + SW_VERSION, {
                updateViaCache: 'none'
            });
            console.log('Service Worker registered successfully');
            swRegistration = registration;
            
            // Simple update check - no aggressive intervals
            registration.update();
            
            // Listen for service worker updates
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (newWorker) {
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New content is available, reload once
                            console.log('New content available, reloading page');
                            window.location.reload();
                        }
                    });
                }
            });

        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    });
}

async function fetchData() {
    // Check if we have cached data that's still valid
    const now = Date.now();
    if (contestsCache && lastFetchTime && (now - lastFetchTime) < CACHE_DURATION) {
        displayContests(contestsCache);
        return;
    }
    
    // Show loading
    contestList.innerHTML = '<li style="text-align: center; padding: 20px; color: #888;">Loading contests...</li>';
    
    try {
        const response = await fetch('https://codeforces.com/api/contest.list');
        const data = await response.json();
        
        // Cache the data
        contestsCache = data.result;
        lastFetchTime = now;
        
        displayContests(contestsCache);
        
        // Schedule notifications for upcoming contests
        if (localStorage.getItem('notificationsEnabled') === 'true') {
            scheduleContestNotifications();
        }
    } catch (error) {
        // Try proxy as fallback
        try {
            const response = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent('https://codeforces.com/api/contest.list'));
            const proxyData = await response.json();
            const data = JSON.parse(proxyData.contents);
            
            contestsCache = data.result;
            lastFetchTime = now;
            
            displayContests(contestsCache);
            
            // Schedule notifications for upcoming contests
            if (localStorage.getItem('notificationsEnabled') === 'true') {
                scheduleContestNotifications();
            }
        } catch (fallbackError) {
            contestList.innerHTML = '<li style="text-align: center; padding: 20px; color: #ff6b6b;">Failed to load contests. Please try again later.</li>';
        }
    }
}

function displayContests(contests) {
    contestList.innerHTML = '';
    
    let filteredContests = contests.filter(contest => {
    
        let statusMatch = false;
        switch(currentFilter) {
            case 'upcoming':
                statusMatch = contest.phase === 'BEFORE';
                break;
            case 'ongoing':
                statusMatch = contest.phase === 'CODING';
                break;
            case 'finished':
                statusMatch = contest.phase === 'FINISHED';
                break;
            default:
                statusMatch = true;
        }
        
        // Then filter by difficulty (based on contest name division)
        let difficultyMatch = false;
        const contestName = contest.name.toLowerCase();
        
        switch(currentDifficulty) {
            case 'easy':
                // Only Div 3, Div 4, and Educational rounds that are NOT rated for Div 2
                difficultyMatch = (contestName.includes('div. 3') || contestName.includes('div.3')) ||
                                (contestName.includes('div. 4') || contestName.includes('div.4')) ||
                                (contestName.includes('educational') && !contestName.includes('rated for div. 2') && !contestName.includes('rated for div.2')) ||
                                // Only include contests that don't have any division mentioned at all
                                (!contestName.includes('div. 1') && 
                                 !contestName.includes('div. 2') && 
                                 !contestName.includes('div. 3') && 
                                 !contestName.includes('div. 4') &&
                                 !contestName.includes('div.1') && 
                                 !contestName.includes('div.2') && 
                                 !contestName.includes('div.3') && 
                                 !contestName.includes('div.4') &&
                                 !contestName.includes('educational') &&
                                 !contestName.includes('rated for'));
                break;
            case 'medium':
                // Only Div 2 and Educational rounds rated for Div 2
                difficultyMatch = (contestName.includes('div. 2') || contestName.includes('div.2')) ||
                                (contestName.includes('educational') && (contestName.includes('rated for div. 2') || contestName.includes('rated for div.2')));
                break;
            case 'hard':
                // Only Div 1
                difficultyMatch = contestName.includes('div. 1') || contestName.includes('div.1');
                break;
            default:
                difficultyMatch = true;
        }
        
        return statusMatch && difficultyMatch;
    });
    
    // Sort contests
    if (currentFilter === 'upcoming' || currentFilter === 'ongoing') {
        // Sort upcoming/ongoing by start time (earliest first)
        filteredContests.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
    } else {
        // Sort finished by start time (most recent first)
        filteredContests.sort((a, b) => b.startTimeSeconds - a.startTimeSeconds);
    }
    
    // Limit results for better performance
    const totalContests = filteredContests.length;
    filteredContests = filteredContests.slice(0, displayLimit);
    
    if (filteredContests.length === 0) {
        contestList.innerHTML = `<li style="text-align: center; padding: 20px; color: #888;">No ${currentFilter} ${currentDifficulty} contests found.</li>`;
        return;
    }
    
    filteredContests.forEach(contest => {
        const li = document.createElement('li');
        li.className = 'contest-card';
        
        // Calculate time remaining or status
        const startTime = new Date(contest.startTimeSeconds * 1000);
        const now = new Date();
        const timeUntilStart = startTime - now;
        
        let timeDisplay;
        
        if (contest.phase === 'FINISHED') {
            timeDisplay = 'Finished';
        } else if (contest.phase === 'CODING') {
            timeDisplay = 'Running Now';
        } else if (timeUntilStart > 0) {
            const days = Math.floor(timeUntilStart / (1000 * 60 * 60 * 24));
            const hours = Math.floor((timeUntilStart % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((timeUntilStart % (1000 * 60 * 60)) / (1000 * 60));
            
            if (days > 0) {
                timeDisplay = `In ${days} day${days > 1 ? 's' : ''}`;
            } else if (hours > 0) {
                timeDisplay = `In ${hours} hour${hours > 1 ? 's' : ''}`;
            } else {
                timeDisplay = `In ${minutes} min${minutes > 1 ? 's' : ''}`;
            }
        } else {
            timeDisplay = 'Starting soon';
        }
        
        li.innerHTML = `
            <div class="contest-info">
                <div class="contest-platform">🏆 Codeforces</div>
                <h3 class="contest-name">${contest.name}</h3>
                <div class="contest-time">${timeDisplay}</div>
            </div>
            <button class="participate-btn" onclick="window.open('https://codeforces.com/contests/${contest.id}', '_blank')">
                Participate
            </button>
        `;
        contestList.appendChild(li);
    });
    
    // Add "See More" button if there are more contests to show
    if (displayLimit < totalContests) {
        const seeMoreContainer = document.createElement('li');
        seeMoreContainer.className = 'see-more-container';
        seeMoreContainer.style.listStyle = 'none';
        seeMoreContainer.innerHTML = `
            <button class="see-more-btn" onclick="loadMoreContests()">
                See More (${totalContests - displayLimit} remaining)
            </button>
        `;
        contestList.appendChild(seeMoreContainer);
    }
}

function loadMoreContests() {
    const increment = getDisplayLimit(); // Load based on screen size
    displayLimit += increment;
    if (contestsCache) {
        displayContests(contestsCache);
    }
}

// Handle window resize to update display limit
window.addEventListener('resize', () => {
    const newLimit = getDisplayLimit();
    // Only update if display limit changes significantly
    if ((newLimit === 4 && displayLimit > 4) || (newLimit === 8 && displayLimit <= 4)) {
        displayLimit = newLimit;
        if (contestsCache) {
            displayContests(contestsCache);
        }
    }
});

// ========== NOTIFICATION FUNCTIONALITY ==========

// Check if notifications are supported and get current permission status
function checkNotificationSupport() {
    return 'Notification' in window;
}

// Update notification button state based on permission and settings
function updateNotificationButtonState() {
    const notificationBtn = document.getElementById('notificationBtn');
    if (!notificationBtn) {
        console.error('Notification button not found');
        return;
    }
    
    const notificationIcon = notificationBtn.querySelector('.notification-icon');
    if (!notificationIcon) {
        console.error('Notification icon not found');
        return;
    }
    
    const notificationStatus = notificationBtn.querySelector('.notification-status');
    
    // Reset classes and inline styles
    notificationBtn.className = 'notification-button';
    notificationBtn.removeAttribute('style');
    
    if (!checkNotificationSupport()) {
        notificationIcon.textContent = '🔔'; // Always show a bell icon
        notificationBtn.disabled = true;
        notificationBtn.title = 'Notifications Not Supported';
        
        // Apply default blue styles
        applyBlueStyle(notificationBtn, notificationStatus);
        return;
    }
    
    const isEnabled = localStorage.getItem('notificationsEnabled') === 'true';
    console.log('Setting button appearance for state:', isEnabled ? 'ENABLED' : 'DISABLED');
    
    // Always show a bell icon, regardless of permission or enabled state
    notificationIcon.textContent = '🔔';
    
    if (isEnabled && Notification.permission === 'granted') {
        // Enabled state - GREEN
        notificationBtn.title = 'Notifications On - Click to Disable';
        applyGreenStyle(notificationBtn, notificationStatus);
        console.log('Applied GREEN style to button');
    } else {
        // Disabled state - BLUE (whether permission is default or denied)
        if (Notification.permission === 'denied') {
            notificationBtn.title = 'Notifications Blocked - Check Browser Settings';
        } else {
            notificationBtn.title = 'Notifications Off - Click to Enable';
        }
        applyBlueStyle(notificationBtn, notificationStatus);
        console.log('Applied BLUE style to button');
    }
}

// Helper function to apply green style to button
function applyGreenStyle(button, statusIndicator) {
    button.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
    button.style.border = '2px solid #10b981';
    button.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.5)';
    button.style.color = 'white';
    
    // Apply style to status indicator
    if (statusIndicator) {
        statusIndicator.style.background = '#10b981';
        statusIndicator.style.boxShadow = '0 0 8px #10b981';
        // Add glow effect
        animateGlow(statusIndicator);
    }
}

// Helper function to apply blue style to button
function applyBlueStyle(button, statusIndicator) {
    button.style.background = 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)';
    button.style.border = '2px solid transparent';
    button.style.boxShadow = '0 4px 15px rgba(74, 144, 226, 0.3)';
    button.style.color = 'white';
    
    // Reset status indicator
    if (statusIndicator) {
        statusIndicator.style.background = 'transparent';
        statusIndicator.style.boxShadow = 'none';
        // Stop any animations
        statusIndicator.style.animation = 'none';
    }
}

// Helper function to animate glow effect
function animateGlow(element) {
    element.style.animation = 'glow 2s infinite alternate';
}

// Toggle notification functionality
async function toggleNotifications() {
    const notificationBtn = document.getElementById('notificationBtn');
    if (!notificationBtn) return;
    
    const notificationIcon = notificationBtn.querySelector('.notification-icon');
    if (!notificationIcon) return;
    
    const notificationStatus = notificationBtn.querySelector('.notification-status');
    
    if (!checkNotificationSupport()) {
        alert('Push notifications are not supported in this browser.');
        return;
    }
    
    // Get current state before toggling
    const isCurrentlyEnabled = localStorage.getItem('notificationsEnabled') === 'true';
    
    // DISABLING PATH: If currently enabled, disable immediately
    if (isCurrentlyEnabled) {
        localStorage.setItem('notificationsEnabled', 'false');
        
        try {
            await unsubscribeFromNotifications();
            clearScheduledNotifications();
            alert('Notifications disabled. You won\'t receive contest reminders.');
        } catch (error) {
            localStorage.setItem('notificationsEnabled', 'true');
        }
        return;
    }
    
    // ENABLING PATH: Request permission if needed
    if (Notification.permission === 'denied') {
        alert('Notifications are blocked. Please enable them in your browser settings:\n\n1. Click the lock icon in the address bar\n2. Allow notifications for this site\n3. Refresh the page');
        return;
    }
    
    if (Notification.permission === 'default') {
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                alert('Notifications permission denied. You won\'t receive contest reminders.');
                return;
            }
        } catch (error) {
            alert('There was an error requesting notification permission.');
            return;
        }
    }
    
    // Enable notifications
    localStorage.setItem('notificationsEnabled', 'true');
    
    try {
        await subscribeToNotifications();
        scheduleContestNotifications();
        
        if (Notification.permission === 'granted') {
            showTestNotification();
        }
        
        alert('Notifications enabled! You\'ll receive reminders about:\n• New contests added to Codeforces\n• Contests starting in 1 hour');
    } catch (error) {
        localStorage.setItem('notificationsEnabled', 'false');
    }
}

// Update notification button without recreating it
function refreshNotificationButton() {
    const notificationBtn = document.getElementById('notificationBtn');
    if (!notificationBtn) return;
    
    // Force update the button state
    const isEnabled = localStorage.getItem('notificationsEnabled') === 'true';
    const notificationIcon = notificationBtn.querySelector('.notification-icon');
    if (!notificationIcon) return;
    
    const notificationStatus = notificationBtn.querySelector('.notification-status');
    
    // Reset all styles first
    notificationBtn.removeAttribute('style');
    
    // Always show a bell icon
    notificationIcon.textContent = '🔔';
    
    // Apply the appropriate style based on current state
    if (isEnabled && Notification.permission === 'granted') {
        notificationBtn.title = 'Notifications On - Click to Disable';
        applyGreenStyle(notificationBtn, notificationStatus);
    } else {
        if (Notification.permission === 'denied') {
            notificationBtn.title = 'Notifications Blocked - Check Browser Settings';
        } else {
            notificationBtn.title = 'Notifications Off - Click to Enable';
        }
        applyBlueStyle(notificationBtn, notificationStatus);
    }
    
    // Reset processing flag
    notificationBtn.dataset.processing = 'false';
}

// Subscribe to notifications
async function subscribeToNotifications() {
    try {
        // First check if we can use the service worker for push notifications
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            try {
                // Make sure service worker is registered and active
                if (!swRegistration) {
                    swRegistration = await navigator.serviceWorker.ready;
                }
                
                // Check if already subscribed
                let subscription = await swRegistration.pushManager.getSubscription();
                
                if (!subscription) {
                    // We need to create a new subscription
                    // This is a placeholder for actual VAPID keys you would use in production
                    const applicationServerKey = urlBase64ToUint8Array(
                        'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
                    );
                    
                    subscription = await swRegistration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: applicationServerKey
                    });
                    
                    console.log('Push notification subscription successful');
                }
            } catch (swError) {
                console.log('Service worker push subscription not available:', swError);
                // Continue with basic notifications
            }
        } else {
            console.log('Using basic notifications without push');
        }
        
        // Store subscription preference in localStorage
        localStorage.setItem('notificationsEnabled', 'true');
        
    } catch (error) {
        console.error('Failed to subscribe to notifications:', error);
        // Fallback to basic notification permission
        localStorage.setItem('notificationsEnabled', 'true');
    }
}

// Helper function for VAPID key conversion
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Unsubscribe from notifications
async function unsubscribeFromNotifications() {
    try {
        // Try to unsubscribe from push notifications if service worker is available
        if ('serviceWorker' in navigator && 'PushManager' in window && swRegistration) {
            try {
                const subscription = await swRegistration.pushManager.getSubscription();
                
                if (subscription) {
                    await subscription.unsubscribe();
                    console.log('Successfully unsubscribed from push notifications');
                }
            } catch (swError) {
                console.log('Error unsubscribing from push notifications:', swError);
                // Continue with basic notification disabling
            }
        }
        
        // Always update localStorage regardless of push unsubscribe success
        localStorage.setItem('notificationsEnabled', 'false');
        
    } catch (error) {
        console.error('Failed to unsubscribe from notifications:', error);
        // Fallback to just updating localStorage
        localStorage.setItem('notificationsEnabled', 'false');
    }
}

// Convert VAPID key from base64 to Uint8Array
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');
    
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Show a test notification when notifications are enabled
function showTestNotification() {
    try {
        if (Notification.permission === 'granted') {
            // Create notification options
            const notificationOptions = {
                body: 'You\'ll now receive reminders for:\n• New contests added to Codeforces\n• Contests starting in 1 hour',
                tag: 'test-notification',
                timestamp: Date.now(),
                vibrate: [200, 100, 200], // Vibration pattern for mobile
                requireInteraction: false // Auto-close on most platforms
            };
            
            // Try to add icons if we're not running from file:// protocol
            if (window.location.protocol !== 'file:') {
                notificationOptions.icon = 'icon-192.png'; // Path to notification icon
                notificationOptions.badge = 'icon-192.png'; // For Android
            }
            
            const notification = new Notification('CodeRally Notifications Enabled! 🎉', notificationOptions);
            
            // Add click handler for the notification
            notification.onclick = function() {
                window.focus();
                notification.close();
            };
            
            // Auto-close the notification after 5 seconds
            setTimeout(() => {
                notification.close();
            }, 5000);
            
            console.log('Test notification displayed successfully');
            return true;
        } else {
            console.log('Notification permission is not granted, cannot show notification');
            return false;
        }
    } catch (error) {
        console.error('Error showing test notification:', error);
        // Show a fallback alert on error
        setTimeout(() => {
            alert('Notifications enabled! You\'ll get reminders for upcoming contests.');
        }, 500);
        return false;
    }
}

// Schedule notifications for upcoming contests
function scheduleContestNotifications() {
    if (!contestsCache || localStorage.getItem('notificationsEnabled') !== 'true') {
        return;
    }
    
    // Clear existing scheduled notifications
    clearScheduledNotifications();
    
    // Filter upcoming contests based on current difficulty filter
    const upcomingContests = contestsCache.filter(contest => {
        const statusMatch = contest.phase === 'BEFORE';
        const difficultyMatch = checkDifficultyMatch(contest, currentDifficulty);
        const startTime = new Date(contest.startTimeSeconds * 1000);
        const now = new Date();
        const timeUntilStart = startTime - now;
        
        // Only schedule notifications for contests starting within the next 7 days
        return statusMatch && difficultyMatch && timeUntilStart > 0 && timeUntilStart <= 7 * 24 * 60 * 60 * 1000;
    });
    
    // Find newly added contests (posted within last 24 hours)
    const newContests = contestsCache.filter(contest => {
        // Use contest ID to estimate when it was added (higher ID = more recent)
        // This is a heuristic since Codeforces API doesn't provide 'added date'
        const isNew = contest.id > localStorage.getItem('lastSeenContestId');
        const statusMatch = contest.phase === 'BEFORE'; // Only notify for upcoming contests
        
        // Update the last seen contest ID if we found a newer one
        if (isNew && contest.id > (localStorage.getItem('lastSeenContestId') || 0)) {
            localStorage.setItem('lastSeenContestId', contest.id);
        }
        
        return isNew && statusMatch;
    });
    
    // Notify for new contests immediately
    newContests.forEach(contest => {
        // Don't notify for new contests if this is the first time app is used
        if (localStorage.getItem('firstRun') !== 'true') {
            setTimeout(() => {
                showNewContestNotification(contest);
            }, 3000); // Small delay to avoid overwhelming with notifications
        }
    });
    
    // Mark first run as complete
    localStorage.setItem('firstRun', 'false');
    
    upcomingContests.forEach(contest => {
        const startTime = new Date(contest.startTimeSeconds * 1000);
        const now = new Date();
        const timeUntilStart = startTime - now;
        
        // Schedule notification 1 hour before contest starts
        const oneHourNotificationTime = new Date(startTime.getTime() - 60 * 60 * 1000);
        
        if (oneHourNotificationTime > now) {
            const timeoutId = setTimeout(() => {
                showContestNotification(contest, 'hour');
            }, oneHourNotificationTime - now);
            
            // Store timeout ID
            const timeouts = JSON.parse(localStorage.getItem('notificationTimeouts') || '[]');
            timeouts.push(timeoutId);
            localStorage.setItem('notificationTimeouts', JSON.stringify(timeouts));
        }
    });
}

// Clear all scheduled notifications
function clearScheduledNotifications() {
    const timeouts = JSON.parse(localStorage.getItem('notificationTimeouts') || '[]');
    timeouts.forEach(timeoutId => clearTimeout(timeoutId));
    localStorage.setItem('notificationTimeouts', '[]');
}

// Show notification for a specific contest
function showContestNotification(contest, notificationType = 'default') {
    if (Notification.permission !== 'granted' || localStorage.getItem('notificationsEnabled') !== 'true') {
        return;
    }
    
    const startTime = new Date(contest.startTimeSeconds * 1000);
    let timePrefix, requireUrgent = false;
    
    switch(notificationType) {
        case 'hour':
            timePrefix = '⏰ Starting in 1 hour!';
            requireUrgent = true;
            break;
        default:
            timePrefix = '⏰ Coming up!';
    }
    
    const notification = new Notification(`${timePrefix} ${contest.name}`, {
        body: `Codeforces contest starting at ${startTime.toLocaleTimeString()} on ${startTime.toLocaleDateString()}`,
        icon: './icon-192.png',
        badge: './favicon-32x32.png',
        tag: `contest-${contest.id}`,
        requireInteraction: requireUrgent,
        actions: [
            {
                action: 'participate',
                title: 'Participate Now'
            },
            {
                action: 'dismiss',
                title: 'Dismiss'
            }
        ]
    });
    
    notification.onclick = () => {
        window.open(`https://codeforces.com/contests/${contest.id}`, '_blank');
        notification.close();
    };
}

// Show notification for a newly added contest
function showNewContestNotification(contest) {
    if (Notification.permission !== 'granted' || localStorage.getItem('notificationsEnabled') !== 'true') {
        return;
    }
    
    const startTime = new Date(contest.startTimeSeconds * 1000);
    const now = new Date();
    const daysUntilStart = Math.ceil((startTime - now) / (1000 * 60 * 60 * 24));
    
    const notification = new Notification(`🆕 New Contest Added: ${contest.name}`, {
        body: `Starting in ${daysUntilStart} day${daysUntilStart > 1 ? 's' : ''} on ${startTime.toLocaleDateString()}`,
        icon: './icon-192.png',
        badge: './favicon-32x32.png',
        tag: `new-contest-${contest.id}`,
        actions: [
            {
                action: 'view',
                title: 'View Details'
            },
            {
                action: 'dismiss',
                title: 'Dismiss'
            }
        ]
    });
    
    notification.onclick = () => {
        window.open(`https://codeforces.com/contests/${contest.id}`, '_blank');
        notification.close();
    };
}

// Helper function to check if contest matches difficulty filter
function checkDifficultyMatch(contest, difficulty) {
    const contestName = contest.name.toLowerCase();
    
    switch(difficulty) {
        case 'easy':
            return (contestName.includes('div. 3') || contestName.includes('div.3')) ||
                   (contestName.includes('div. 4') || contestName.includes('div.4')) ||
                   (contestName.includes('educational') && !contestName.includes('rated for div. 2') && !contestName.includes('rated for div.2'));
        case 'medium':
            return (contestName.includes('div. 2') || contestName.includes('div.2')) ||
                   (contestName.includes('educational') && (contestName.includes('rated for div. 2') || contestName.includes('rated for div.2')));
        case 'hard':
            return contestName.includes('div. 1') || contestName.includes('div.1');
        default:
            return true;
    }
}

// ==================== PROBLEMS PAGE FUNCTIONALITY ====================

// ==================== PROBLEMS PAGE FUNCTIONALITY ====================

// Problems page variables
let problemsData = [];
let filteredProblems = [];
let currentProblemsPage = 0;
const PROBLEMS_PER_PAGE = 24; // Show 24 problems (8 rows of 3 problems each)
let currentProblemFilters = {
    dataStructure: 'array',
    difficulty: 'easy',
    search: ''
};

// Backup problems data in case API fails completely
const backupProblems = [
    {
        "contestId": 1,
        "index": "A",
        "name": "Theatre Square",
        "type": "PROGRAMMING",
        "rating": 1000,
        "tags": ["math"]
    },
    {
        "contestId": 4,
        "index": "A",
        "name": "Watermelon",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["brute force", "math"]
    },
    {
        "contestId": 71,
        "index": "A",
        "name": "Way Too Long Words",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["strings"]
    },
    {
        "contestId": 158,
        "index": "A",
        "name": "Next Round",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["implementation"]
    },
    {
        "contestId": 231,
        "index": "A",
        "name": "Team",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["brute force", "greedy"]
    },
    {
        "contestId": 282,
        "index": "A",
        "name": "Bit++",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["implementation"]
    },
    {
        "contestId": 339,
        "index": "A",
        "name": "Helpful Maths",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["greedy", "implementation", "sortings", "strings"]
    },
    {
        "contestId": 546,
        "index": "A",
        "name": "Soldier and Bananas",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["brute force", "implementation", "math"]
    },
    {
        "contestId": 617,
        "index": "A",
        "name": "Elephant",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["math"]
    },
    {
        "contestId": 677,
        "index": "A",
        "name": "Vanya and Fence",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["implementation"]
    },
    {
        "contestId": 734,
        "index": "A",
        "name": "Anton and Danik",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["implementation", "strings"]
    },
    {
        "contestId": 800,
        "index": "A",
        "name": "Voltage Keepsake",
        "type": "PROGRAMMING",
        "rating": 1600,
        "tags": ["binary search", "math"]
    },
    {
        "contestId": 977,
        "index": "A",
        "name": "Wrong Subtraction",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["implementation"]
    },
    {
        "contestId": 1030,
        "index": "A",
        "name": "In Search of an Easy Problem",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["implementation"]
    },
    {
        "contestId": 1154,
        "index": "A",
        "name": "Restoring Three Numbers",
        "type": "PROGRAMMING",
        "rating": 800,
        "tags": ["math"]
    }
];

// Check if we're on the problems page
if (window.location.pathname.includes('problems.html')) {
    document.addEventListener('DOMContentLoaded', function() {
        initProblemsPage();
    });
}

function initProblemsPage() {
    const dataStructureButtons = document.querySelectorAll('#array, #linkedlist, #tree, #graph, #string, #dp, #math, #greedy');
    const difficultyButtons = document.querySelectorAll('#easy, #medium, #hard');
    const searchInput = document.getElementById('searchInput');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    const installBtn = document.getElementById('installBtn');
    
    // Initialize with "array" and "easy" as active
    document.getElementById('array').classList.add('active');
    document.getElementById('easy').classList.add('active');
    
    // Install button functionality
    if (installBtn) {
        installBtn.addEventListener('click', function(e) {
            e.preventDefault();
            if (window.deferredPrompt) {
                window.deferredPrompt.prompt();
                window.deferredPrompt.userChoice.then(function(choiceResult) {
                    if (choiceResult.outcome === 'accepted') {
                        console.log('User accepted the install prompt');
                    } else {
                        console.log('User dismissed the install prompt');
                    }
                    window.deferredPrompt = null;
                });
            }
        });
        
        // Hide install button if PWA is already installed
        if (window.matchMedia('(display-mode: standalone)').matches) {
            installBtn.style.display = 'none';
        }
    }
    
    // Data structure filter buttons
    dataStructureButtons.forEach(button => {
        button.addEventListener('click', function() {
            dataStructureButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            currentProblemFilters.dataStructure = this.id;
            filterAndDisplayProblems();
        });
    });
    
    // Difficulty filter buttons
    difficultyButtons.forEach(button => {
        button.addEventListener('click', function() {
            difficultyButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            currentProblemFilters.difficulty = this.id;
            filterAndDisplayProblems();
        });
    });
    
    // Search input
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            currentProblemFilters.search = this.value.toLowerCase();
            filterAndDisplayProblems();
        });
    }
    
    // Load more button
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', function() {
            loadMoreProblems();
        });
    }
    
    // Load initial problems
    fetchProblems();
}

async function fetchProblems() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    
    try {
        if (loadingIndicator) {
            loadingIndicator.style.display = 'block';
        }
        
        // Check for cached problems and their validity
        const cachedProblems = localStorage.getItem('cachedProblems');
        const lastFetchTime = localStorage.getItem('problemsFetchTime');
        const now = new Date().getTime();
        const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours cache (problems don't change often)
        
        // Use cached data if available and not expired
        if (cachedProblems && lastFetchTime && (now - parseInt(lastFetchTime) < CACHE_DURATION)) {
            problemsData = JSON.parse(cachedProblems);
            filterAndDisplayProblems();
            console.log("Using cached problems data");
            return;
        }
        
        // Try to fetch from Codeforces API directly first
        let response;
        let data;
        
        try {
            console.log("Fetching problems from Codeforces API...");
            response = await fetch('https://codeforces.com/api/problemset.problems');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            data = await response.json();
        } catch (directError) {
            console.log("Direct API failed, trying CORS proxy...", directError);
            
            // Fallback to CORS proxy
            try {
                response = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent('https://codeforces.com/api/problemset.problems'));
                
                if (!response.ok) {
                    throw new Error(`Proxy HTTP error! status: ${response.status}`);
                }
                
                const proxyData = await response.json();
                data = JSON.parse(proxyData.contents);
            } catch (proxyError) {
                console.log("Proxy also failed, trying alternative proxy...", proxyError);
                
                // Try alternative CORS proxy
                response = await fetch('https://cors-anywhere.herokuapp.com/https://codeforces.com/api/problemset.problems');
                
                if (!response.ok) {
                    throw new Error(`Alternative proxy HTTP error! status: ${response.status}`);
                }
                
                data = await response.json();
            }
        }
        
        if (data && data.status === 'OK' && data.result && data.result.problems) {
            problemsData = data.result.problems;
            
            // Cache the problems data with extended duration
            localStorage.setItem('cachedProblems', JSON.stringify(problemsData));
            localStorage.setItem('problemsFetchTime', now.toString());
            
            console.log(`Fetched ${problemsData.length} problems successfully`);
            filterAndDisplayProblems();
        } else {
            throw new Error('Invalid API response structure');
        }
    } catch (error) {
        console.error('Error fetching problems:', error);
        
        // Try to use any cached data as fallback, even if expired
        const cachedProblems = localStorage.getItem('cachedProblems');
        if (cachedProblems) {
            console.log("Using expired cached data as fallback");
            problemsData = JSON.parse(cachedProblems);
            filterAndDisplayProblems();
            
            if (loadingIndicator) {
                loadingIndicator.innerHTML = 'Using cached data (may be outdated)';
                setTimeout(() => {
                    if (loadingIndicator) {
                        loadingIndicator.style.display = 'none';
                    }
                }, 2000);
            }
        } else {
            // Use backup problems as last resort
            console.log("Using backup problems data");
            problemsData = backupProblems;
            filterAndDisplayProblems();
            
            if (loadingIndicator) {
                loadingIndicator.innerHTML = 'Using sample problems (connection issues detected)';
                setTimeout(() => {
                    if (loadingIndicator) {
                        loadingIndicator.style.display = 'none';
                    }
                }, 3000);
            }
        }
    } finally {
        // Only hide loading if we're not showing a message
        if (loadingIndicator && !loadingIndicator.innerHTML.includes('cached data') && !loadingIndicator.innerHTML.includes('Failed')) {
            loadingIndicator.style.display = 'none';
        }
    }
}

function filterAndDisplayProblems() {
    // Filter problems based on current filters
    filteredProblems = problemsData.filter(problem => {
        // Data structure filter
        const tags = problem.tags || [];
        const dataStructureMatch = checkDataStructureMatch(tags, currentProblemFilters.dataStructure);
        
        // Difficulty filter
        const difficultyMatch = checkProblemDifficultyMatch(problem, currentProblemFilters.difficulty);
        
        // Search filter
        const searchMatch = currentProblemFilters.search === '' || 
            problem.name.toLowerCase().includes(currentProblemFilters.search) ||
            tags.some(tag => tag.toLowerCase().includes(currentProblemFilters.search));
        
        return dataStructureMatch && difficultyMatch && searchMatch;
    });
    
    // Sort problems by rating in ascending order
    filteredProblems.sort((a, b) => {
        // Handle problems with no rating
        const ratingA = a.rating || 0;
        const ratingB = b.rating || 0;
        return ratingA - ratingB;
    });
    
    // Reset pagination
    currentProblemsPage = 0;
    
    // Show loading indicator
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.style.display = 'block';
    }
    
    // Clear current problems list
    const problemsList = document.getElementById('problemsList');
    if (problemsList) {
        problemsList.innerHTML = '';
    }
    
    // Display first page
    setTimeout(() => {
        displayProblems();
    }, 100); // Small delay to ensure DOM updates properly
}

function checkDataStructureMatch(tags, dataStructure) {
    const tagString = tags.join(' ').toLowerCase();
    
    switch(dataStructure) {
        case 'array':
            return tags.some(tag => 
                tag.toLowerCase().includes('implementation') ||
                tag.toLowerCase().includes('prefix') || 
                tag.toLowerCase().includes('suffix') || 
                tag.toLowerCase().includes('two pointers') || 
                tag.toLowerCase().includes('sorting')
            );
        case 'linkedlist':
            return tags.some(tag => 
                tag.toLowerCase().includes('simulation') || 
                (tag.toLowerCase().includes('implementation') && tagString.includes('pointer'))
            );
        case 'tree':
            return tags.some(tag => 
                tag.toLowerCase().includes('trees') ||
                tag.toLowerCase().includes('dfs') ||
                tag.toLowerCase().includes('binary search') ||
                tag.toLowerCase().includes('segment tree') ||
                tag.toLowerCase().includes('tree')
            );
        case 'graph':
            return tags.some(tag => 
                tag.toLowerCase().includes('graphs') ||
                tag.toLowerCase().includes('bfs') ||
                tag.toLowerCase().includes('dfs') ||
                tag.toLowerCase().includes('shortest path') ||
                tag.toLowerCase().includes('connected component')
            );
        case 'string':
            return tags.some(tag => 
                tag.toLowerCase().includes('strings') ||
                tag.toLowerCase().includes('hashing') ||
                tag.toLowerCase().includes('palindrome') ||
                tag.toLowerCase().includes('suffix array')
            );
        case 'dp':
            return tags.some(tag => 
                tag.toLowerCase().includes('dp') ||
                tag.toLowerCase().includes('dynamic programming') ||
                tag.toLowerCase().includes('digit dp') ||
                tag.toLowerCase().includes('knapsack') ||
                tag.toLowerCase().includes('memoization')
            );
        case 'math':
            return tags.some(tag => 
                tag.toLowerCase().includes('math') ||
                tag.toLowerCase().includes('number theory') ||
                tag.toLowerCase().includes('combinatorics') ||
                tag.toLowerCase().includes('probabilities')
            );
        case 'greedy':
            return tags.some(tag => 
                tag.toLowerCase().includes('greedy') ||
                tag.toLowerCase().includes('constructive algorithm')
            );
        default:
            return true;
    }
}

function checkProblemDifficultyMatch(problem, difficulty) {
    const rating = problem.rating || 0;
    
    switch(difficulty) {
        case 'easy':
            return rating >= 800 && rating <= 1299;
        case 'medium':
            return rating >= 1300 && rating <= 1799;
        case 'hard':
            return rating >= 1800;
        default:
            return true;
    }
}

function displayProblems() {
    const problemsList = document.getElementById('problemsList');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    const loadingIndicator = document.getElementById('loadingIndicator');
    
    if (!problemsList) return;
    
    // Hide loading indicator once problems are ready to display
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }
    
    const startIndex = currentProblemsPage * PROBLEMS_PER_PAGE;
    const endIndex = startIndex + PROBLEMS_PER_PAGE;
    const problemsToShow = filteredProblems.slice(startIndex, endIndex);
    
    problemsToShow.forEach(problem => {
        const problemElement = createProblemElement(problem);
        problemsList.appendChild(problemElement);
    });
    
    // Show/hide load more button
    if (loadMoreBtn) {
        if (endIndex < filteredProblems.length) {
            loadMoreBtn.style.display = 'block';
        } else {
            loadMoreBtn.style.display = 'none';
        }
    }
}

function loadMoreProblems() {
    currentProblemsPage++;
    displayProblems();
}

function createProblemElement(problem) {
    const problemDiv = document.createElement('div');
    problemDiv.className = 'problem-item';
    
    const difficultyClass = getDifficultyClass(problem.rating);
    let difficultyText = getDifficultyText(problem.rating);
    
    // Color code the difficulty rating based on class
    if (difficultyClass === 'easy') {
        difficultyText = `<span style="color: #10b981">${difficultyText}</span>`;
    } else if (difficultyClass === 'medium') {
        difficultyText = `<span style="color: #f59e0b">${difficultyText}</span>`;
    } else if (difficultyClass === 'hard') {
        difficultyText = `<span style="color: #ef4444">${difficultyText}</span>`;
    }
    
    // Limit tags to 2 to prevent overflow
    const displayTags = problem.tags.slice(0, 2);
    
    problemDiv.innerHTML = `
        <div class="problem-header">
            <h3 class="problem-title">${problem.name}</h3>
        </div>
        <div class="problem-meta">
            <span class="problem-id">${problem.contestId}${problem.index}</span>
            <span class="problem-difficulty ${difficultyClass}">${difficultyText}</span>
        </div>
        <div class="problem-tags">
            ${displayTags.map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
        <div class="problem-actions">
            <button class="solve-btn" onclick="window.open('https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}', '_blank')">
                Solve
            </button>
        </div>
    `;
    
    return problemDiv;
}

function getDifficultyClass(rating) {
    if (!rating) return 'unrated';
    if (rating >= 800 && rating <= 1299) return 'easy';
    if (rating >= 1300 && rating <= 1799) return 'medium';
    if (rating >= 1800) return 'hard';
    return 'unrated';
}

function getDifficultyText(rating) {
    if (!rating) return 'Unrated';
    return rating.toString();
}

// Page initialization based on location
document.addEventListener('DOMContentLoaded', function() {
    // Initialize the appropriate page
    if (window.location.pathname.includes('problems.html')) {
        // We're on the problems page - initialization already handled
    } else {
        // We're on the home page - additional initializations can go here
    }
});