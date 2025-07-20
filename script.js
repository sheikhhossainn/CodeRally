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
    
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        isPWAInstallable = true;
        installBtn.textContent = 'Install App';
    });
    
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt && isPWAInstallable) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                installBtn.textContent = 'App Installed!';
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
        installBtn.textContent = 'App Installed!';
        installBtn.disabled = true;
    });
    
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
    
    // Set default active states
    document.getElementById('codeforces').classList.add('active');
    document.getElementById('easy').classList.add('active');
    document.getElementById('upcoming').classList.add('active');
    
    // Initial load
    fetchData();
});

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./serviceWorker.js')
            .then((registration) => {
                console.log('Service Worker registered successfully');
                swRegistration = registration;
            })
            .catch((registrationError) => {
                console.error('Service Worker registration failed:', registrationError);
            });
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
        if ('serviceWorker' in navigator && 'PushManager' in window && swRegistration) {
            try {
                // Check if already subscribed
                let subscription = await swRegistration.pushManager.getSubscription();
                
                if (!subscription) {
                    console.log('Using local notifications for demo');
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