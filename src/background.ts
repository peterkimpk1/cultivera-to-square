import { getSupabase, onAuthStateChange, getSession, refreshSession } from './lib/supabase';

/**
 * Background service worker for the Cultivera to Square extension.
 * Handles:
 * - Auth state persistence
 * - Session refresh
 * - Communication between popup and content scripts
 */

// Initialize Supabase client on startup
getSupabase();

// Restore session on startup
async function restoreSession(): Promise<void> {
  try {
    const session = await getSession();
    if (session) {
      console.log('[Background] Session restored for user:', session.user.email);

      // Check if session needs refresh (within 5 minutes of expiry)
      const expiresAt = session.expires_at || 0;
      const now = Math.floor(Date.now() / 1000);
      const fiveMinutes = 5 * 60;

      if (expiresAt - now < fiveMinutes) {
        console.log('[Background] Session expiring soon, refreshing...');
        await refreshSession();
      }
    } else {
      console.log('[Background] No session to restore');
    }
  } catch (error) {
    console.error('[Background] Error restoring session:', error);
  }
}

// Listen for auth state changes
onAuthStateChange((event, session) => {
  console.log('[Background] Auth state changed:', event);

  if (event === 'SIGNED_IN' && session) {
    // Notify all Cultivera tabs that user signed in
    notifyCultiveraTabs({ type: 'AUTH_STATE_CHANGED', signedIn: true });
  } else if (event === 'SIGNED_OUT') {
    // Notify all Cultivera tabs that user signed out
    notifyCultiveraTabs({ type: 'AUTH_STATE_CHANGED', signedIn: false });
  } else if (event === 'TOKEN_REFRESHED') {
    console.log('[Background] Token refreshed successfully');
  }
});

/**
 * Notify all Cultivera tabs of a message
 */
async function notifyCultiveraTabs(message: { type: string; [key: string]: unknown }): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.cultivera.com/*' });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab might not have content script loaded yet, ignore error
        });
      }
    }
  } catch (error) {
    console.error('[Background] Error notifying tabs:', error);
  }
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_AUTH_STATE') {
    getSession()
      .then((session) => {
        sendResponse({ signedIn: !!session, email: session?.user.email });
      })
      .catch(() => {
        sendResponse({ signedIn: false });
      });
    return true; // Keep channel open for async response
  }

  if (message.type === 'REFRESH_SESSION') {
    refreshSession()
      .then((session) => {
        sendResponse({ success: !!session });
      })
      .catch(() => {
        sendResponse({ success: false });
      });
    return true;
  }
});

// Set up periodic session refresh (every 50 minutes)
const REFRESH_INTERVAL = 50 * 60 * 1000; // 50 minutes

function setupSessionRefresh(): void {
  setInterval(async () => {
    const session = await getSession();
    if (session) {
      console.log('[Background] Performing periodic session refresh');
      await refreshSession();
    }
  }, REFRESH_INTERVAL);
}

// Initialize on service worker startup
restoreSession();
setupSessionRefresh();

console.log('[Background] Cultivera to Square service worker initialized');
