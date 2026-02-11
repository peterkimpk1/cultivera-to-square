import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';

// Supabase configuration (anon key is safe to commit - protected by RLS)
const SUPABASE_URL = 'https://zxrtfrqsoaqzjzyerwjl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4cnRmcnFzb2Fxemp6eWVyd2psIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxMDM2NTQsImV4cCI6MjA4MjY3OTY1NH0.K4Om8WfBBlOPcYlPhmnLlqkDtVK1degrkUrnQdBcTgs'; // Replace with your anon key

// Storage keys
const STORAGE_KEY_SESSION = 'cultivera_square_session';

/**
 * Custom storage adapter for Chrome extension using chrome.storage.local
 */
const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || null);
      });
    });
  },

  async setItem(key: string, value: string): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve();
      });
    });
  },

  async removeItem(key: string): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], () => {
        resolve();
      });
    });
  },
};

/**
 * Create a Supabase client configured for Chrome extension environment
 */
function createSupabaseClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: chromeStorageAdapter,
      storageKey: STORAGE_KEY_SESSION,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

// Singleton instance
let supabaseInstance: SupabaseClient | null = null;

/**
 * Get the Supabase client singleton
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createSupabaseClient();
  }
  return supabaseInstance;
}

/**
 * Sign in with email and password
 */
export async function signIn(
  email: string,
  password: string
): Promise<{ session: Session | null; error: Error | null }> {
  const supabase = getSupabase();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { session: null, error };
  }

  return { session: data.session, error: null };
}

/**
 * Sign out the current user
 */
export async function signOut(): Promise<{ error: Error | null }> {
  const supabase = getSupabase();
  const { error } = await supabase.auth.signOut();
  return { error: error || null };
}

/**
 * Get the current session
 */
export async function getSession(): Promise<Session | null> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Get the current user
 */
export async function getUser(): Promise<{
  id: string;
  email: string;
} | null> {
  const session = await getSession();
  if (!session?.user) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email || '',
  };
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return session !== null;
}

/**
 * Get the current access token
 */
export async function getAccessToken(): Promise<string | null> {
  const session = await getSession();
  return session?.access_token || null;
}

/**
 * Subscribe to auth state changes
 */
export function onAuthStateChange(
  callback: (event: string, session: Session | null) => void
): { unsubscribe: () => void } {
  const supabase = getSupabase();
  const { data } = supabase.auth.onAuthStateChange(callback);
  return { unsubscribe: () => data.subscription.unsubscribe() };
}

/**
 * Refresh the session if needed
 */
export async function refreshSession(): Promise<Session | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.refreshSession();

  if (error) {
    console.error('Failed to refresh session:', error);
    return null;
  }

  return data.session;
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
