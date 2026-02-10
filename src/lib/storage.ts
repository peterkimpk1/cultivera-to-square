import { UserSession } from './types';

// Storage keys
const STORAGE_KEYS = {
  SESSION: 'cultivera_square_session',
  LAST_ORDER: 'cultivera_square_last_order',
  LOCAL_LOG: 'cultivera_square_local_log',
} as const;

/**
 * Get the current user session from chrome.storage.local
 */
export async function getStoredSession(): Promise<UserSession | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.SESSION], (result) => {
      const sessionStr = result[STORAGE_KEYS.SESSION];
      if (!sessionStr) {
        resolve(null);
        return;
      }

      try {
        const session = JSON.parse(sessionStr);
        // Check if session has expired
        if (session.expires_at && session.expires_at * 1000 < Date.now()) {
          resolve(null);
          return;
        }
        resolve(session);
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Store the user session in chrome.storage.local
 */
export async function setStoredSession(session: UserSession): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [STORAGE_KEYS.SESSION]: JSON.stringify(session),
      },
      () => {
        resolve();
      }
    );
  });
}

/**
 * Clear the stored session
 */
export async function clearStoredSession(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEYS.SESSION], () => {
      resolve();
    });
  });
}

/**
 * Store the last processed order (for quick reference)
 */
export async function setLastOrder(orderNumber: string, invoiceId: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [STORAGE_KEYS.LAST_ORDER]: JSON.stringify({
          orderNumber,
          invoiceId,
          timestamp: Date.now(),
        }),
      },
      () => {
        resolve();
      }
    );
  });
}

/**
 * Get the last processed order
 */
export async function getLastOrder(): Promise<{
  orderNumber: string;
  invoiceId: string;
  timestamp: number;
} | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.LAST_ORDER], (result) => {
      const lastOrderStr = result[STORAGE_KEYS.LAST_ORDER];
      if (!lastOrderStr) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(lastOrderStr));
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Add entry to local action log (for offline reference, max 100 entries)
 */
export async function addToLocalLog(entry: {
  orderNumber: string;
  action: string;
  success: boolean;
  message?: string;
}): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.LOCAL_LOG], (result) => {
      let log: Array<typeof entry & { timestamp: number }> = [];

      try {
        log = JSON.parse(result[STORAGE_KEYS.LOCAL_LOG] || '[]');
      } catch {
        log = [];
      }

      // Add new entry
      log.unshift({
        ...entry,
        timestamp: Date.now(),
      });

      // Keep only last 100 entries
      if (log.length > 100) {
        log = log.slice(0, 100);
      }

      chrome.storage.local.set(
        {
          [STORAGE_KEYS.LOCAL_LOG]: JSON.stringify(log),
        },
        () => {
          resolve();
        }
      );
    });
  });
}

/**
 * Get the local action log
 */
export async function getLocalLog(): Promise<
  Array<{
    orderNumber: string;
    action: string;
    success: boolean;
    message?: string;
    timestamp: number;
  }>
> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.LOCAL_LOG], (result) => {
      try {
        resolve(JSON.parse(result[STORAGE_KEYS.LOCAL_LOG] || '[]'));
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Clear all stored data
 */
export async function clearAllStorage(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(
      [STORAGE_KEYS.SESSION, STORAGE_KEYS.LAST_ORDER, STORAGE_KEYS.LOCAL_LOG],
      () => {
        resolve();
      }
    );
  });
}
