import { signIn, signOut, getUser, onAuthStateChange } from '../lib/supabase';

// DOM Elements
const loadingState = document.getElementById('loading-state')!;
const loginState = document.getElementById('login-state')!;
const signedInState = document.getElementById('signed-in-state')!;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const loginButton = document.getElementById('login-button') as HTMLButtonElement;
const loginError = document.getElementById('login-error')!;
const userEmail = document.getElementById('user-email')!;
const signOutButton = document.getElementById('sign-out-button') as HTMLButtonElement;

/**
 * Show a specific state and hide others
 */
function showState(state: 'loading' | 'login' | 'signed-in'): void {
  loadingState.classList.add('hidden');
  loginState.classList.add('hidden');
  signedInState.classList.add('hidden');

  switch (state) {
    case 'loading':
      loadingState.classList.remove('hidden');
      break;
    case 'login':
      loginState.classList.remove('hidden');
      break;
    case 'signed-in':
      signedInState.classList.remove('hidden');
      break;
  }
}

/**
 * Show error message
 */
function showError(message: string): void {
  loginError.textContent = message;
  loginError.classList.remove('hidden');
}

/**
 * Hide error message
 */
function hideError(): void {
  loginError.classList.add('hidden');
}

/**
 * Initialize the popup
 */
async function init(): Promise<void> {
  showState('loading');

  try {
    const user = await getUser();

    if (user) {
      userEmail.textContent = user.email;
      showState('signed-in');
    } else {
      showState('login');
    }
  } catch (error) {
    console.error('Error initializing popup:', error);
    showState('login');
  }

  // Subscribe to auth state changes
  onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      userEmail.textContent = session.user.email || '';
      showState('signed-in');
    } else if (event === 'SIGNED_OUT') {
      showState('login');
    }
  });
}

/**
 * Handle login form submission
 */
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const email = (document.getElementById('email') as HTMLInputElement).value;
  const password = (document.getElementById('password') as HTMLInputElement).value;

  loginButton.disabled = true;
  loginButton.textContent = 'Signing in...';

  try {
    const { session, error } = await signIn(email, password);

    if (error) {
      showError(error.message || 'Invalid email or password');
      loginButton.disabled = false;
      loginButton.textContent = 'Sign In';
      return;
    }

    if (session) {
      userEmail.textContent = session.user.email || '';
      showState('signed-in');

      // Notify content scripts that auth state changed
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'AUTH_STATE_CHANGED', signedIn: true });
        }
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    showError('An unexpected error occurred. Please try again.');
    loginButton.disabled = false;
    loginButton.textContent = 'Sign In';
  }
});

/**
 * Handle sign out button click
 */
signOutButton.addEventListener('click', async () => {
  signOutButton.disabled = true;
  signOutButton.textContent = 'Signing out...';

  try {
    await signOut();
    showState('login');

    // Notify content scripts that auth state changed
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'AUTH_STATE_CHANGED', signedIn: false });
      }
    });
  } catch (error) {
    console.error('Sign out error:', error);
  } finally {
    signOutButton.disabled = false;
    signOutButton.textContent = 'Sign Out';
  }
});

// Initialize when popup opens
init();
