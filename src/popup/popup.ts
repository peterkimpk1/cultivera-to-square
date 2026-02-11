console.log('[Popup] Script loading...');

import { signIn, signOut, getUser, onAuthStateChange } from '../lib/supabase';
import { parseCultiveraInvoice, parseOrderData } from '../lib/pdf-parser';
import { createInvoice, checkOrderStatus, formatCurrency, getErrorMessage, getErrorTitle } from '../lib/api';
import { addToLocalLog } from '../lib/storage';
import { ScrapedOrderData, ParsedOrderData } from '../lib/types';

console.log('[Popup] Imports loaded');

// ============================================================================
// DOM Elements
// ============================================================================

const loadingState = document.getElementById('loading-state')!;
const loginState = document.getElementById('login-state')!;
const signedInState = document.getElementById('signed-in-state')!;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const loginButton = document.getElementById('login-button') as HTMLButtonElement;
const loginError = document.getElementById('login-error')!;
const userEmail = document.getElementById('user-email')!;
const signOutButton = document.getElementById('sign-out-button') as HTMLButtonElement;

// Upload elements
const uploadZone = document.getElementById('upload-zone')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const processingState = document.getElementById('processing-state')!;
const parseResult = document.getElementById('parse-result')!;
const parseError = document.getElementById('parse-error')!;
const successState = document.getElementById('success-state')!;

// Result elements
const resultOrderNumber = document.getElementById('result-order-number')!;
const resultCustomerName = document.getElementById('result-customer-name')!;
const resultCustomerEmail = document.getElementById('result-customer-email')!;
const resultAmount = document.getElementById('result-amount')!;
const sendInvoiceBtn = document.getElementById('send-invoice-btn') as HTMLButtonElement;
const uploadAnotherBtn = document.getElementById('upload-another-btn') as HTMLButtonElement;

// Error elements
const errorTitle = document.getElementById('error-title')!;
const errorDetails = document.getElementById('error-details')!;
const retryUploadBtn = document.getElementById('retry-upload-btn') as HTMLButtonElement;

// Success elements
const successDetails = document.getElementById('success-details')!;
const uploadNewBtn = document.getElementById('upload-new-btn') as HTMLButtonElement;

// ============================================================================
// State
// ============================================================================

let currentParsedData: ParsedOrderData | null = null;

// ============================================================================
// State Management
// ============================================================================

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
 * Show a specific upload state
 */
function showUploadState(state: 'upload' | 'processing' | 'result' | 'error' | 'success'): void {
  uploadZone.classList.add('hidden');
  processingState.classList.add('hidden');
  parseResult.classList.add('hidden');
  parseError.classList.add('hidden');
  successState.classList.add('hidden');

  switch (state) {
    case 'upload':
      uploadZone.classList.remove('hidden');
      break;
    case 'processing':
      processingState.classList.remove('hidden');
      break;
    case 'result':
      parseResult.classList.remove('hidden');
      break;
    case 'error':
      parseError.classList.remove('hidden');
      break;
    case 'success':
      successState.classList.remove('hidden');
      break;
  }
}

/**
 * Show login error message
 */
function showLoginError(message: string): void {
  loginError.textContent = message;
  loginError.classList.remove('hidden');
}

/**
 * Hide login error message
 */
function hideLoginError(): void {
  loginError.classList.add('hidden');
}

// ============================================================================
// PDF Handling
// ============================================================================

/**
 * Handle a file upload
 */
async function handleFile(file: File): Promise<void> {
  showUploadState('processing');
  currentParsedData = null;

  try {
    const result = await parseCultiveraInvoice(file);

    if (!result.success || !result.data) {
      errorTitle.textContent = 'Could not parse PDF';
      errorDetails.textContent = result.errors.join(' ');
      showUploadState('error');
      return;
    }

    // Parse the order data to get amount in cents
    const parsedData = parseOrderData(result.data);
    if (!parsedData) {
      errorTitle.textContent = 'Could not parse PDF';
      errorDetails.textContent = 'Could not parse order amount.';
      showUploadState('error');
      return;
    }

    // Check if order was already processed
    const orderStatus = await checkOrderStatus(parsedData.order_number);
    if (orderStatus.exists && orderStatus.status === 'completed') {
      errorTitle.textContent = 'Duplicate Order';
      errorDetails.textContent = `Invoice already sent for order #${parsedData.order_number}. View in Square Dashboard.`;
      showUploadState('error');
      return;
    }

    // Store parsed data and show result
    currentParsedData = parsedData;
    displayParseResult(result.data, parsedData);
    showUploadState('result');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errorTitle.textContent = 'Could not parse PDF';
    errorDetails.textContent = `Failed to parse PDF: ${message}`;
    showUploadState('error');
  }
}

/**
 * Display parsed order data
 */
function displayParseResult(scraped: ScrapedOrderData, parsed: ParsedOrderData): void {
  resultOrderNumber.textContent = `#${parsed.order_number}`;
  resultCustomerName.textContent = scraped.customer_name;
  resultCustomerEmail.textContent = scraped.customer_email;
  resultAmount.textContent = formatCurrency(parsed.amount_cents);
}

/**
 * Send invoice to Square
 */
async function handleSendInvoice(): Promise<void> {
  if (!currentParsedData) {
    console.log('[Popup] No parsed data');
    return;
  }

  console.log('[Popup] Sending invoice:', currentParsedData);
  sendInvoiceBtn.disabled = true;
  sendInvoiceBtn.textContent = 'Sending...';

  try {
    const result = await createInvoice(currentParsedData);
    console.log('[Popup] Invoice result:', result);

    // Log the action locally
    await addToLocalLog({
      orderNumber: currentParsedData.order_number,
      action: 'create_invoice',
      success: result.success,
      message: result.success
        ? `Invoice ${result.data?.invoice_number} created`
        : result.error?.message,
    });

    if (result.success && result.data) {
      successDetails.textContent = `Invoice #${result.data.invoice_number} has been emailed to the customer.`;
      showUploadState('success');
    } else {
      const errorCode = result.error?.code || '';
      errorTitle.textContent = getErrorTitle(errorCode);
      const errorMessage = result.error
        ? getErrorMessage(result.error.code, result.error.message)
        : 'An unexpected error occurred.';
      errorDetails.textContent = errorMessage;
      showUploadState('error');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errorTitle.textContent = 'Invoice Creation Failed';
    errorDetails.textContent = `Failed to create invoice: ${message}`;
    showUploadState('error');
  } finally {
    sendInvoiceBtn.disabled = false;
    sendInvoiceBtn.textContent = 'Send to Square';
  }
}

/**
 * Reset to upload state
 */
function resetToUpload(): void {
  currentParsedData = null;
  fileInput.value = '';
  showUploadState('upload');
}

// ============================================================================
// Event Handlers - Upload
// ============================================================================

// Click to browse
uploadZone.addEventListener('click', () => {
  fileInput.click();
});

// File input change
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) {
    handleFile(file);
  }
});

// Drag and drop
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  uploadZone.classList.remove('dragover');

  const file = e.dataTransfer?.files[0];
  if (file) {
    handleFile(file);
  }
});

// Send invoice button
console.log('[Popup] Setting up click handler for sendInvoiceBtn:', sendInvoiceBtn);
sendInvoiceBtn.addEventListener('click', () => {
  console.log('[Popup] Send button clicked!');
  handleSendInvoice();
});

// Upload another button
uploadAnotherBtn.addEventListener('click', resetToUpload);

// Retry button
retryUploadBtn.addEventListener('click', resetToUpload);

// Upload new button (after success)
uploadNewBtn.addEventListener('click', resetToUpload);

// ============================================================================
// Event Handlers - Auth
// ============================================================================

/**
 * Handle login form submission
 */
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideLoginError();

  const email = (document.getElementById('email') as HTMLInputElement).value;
  const password = (document.getElementById('password') as HTMLInputElement).value;

  loginButton.disabled = true;
  loginButton.textContent = 'Signing in...';

  try {
    const { session, error } = await signIn(email, password);

    if (error) {
      showLoginError(error.message || 'Invalid email or password');
      loginButton.disabled = false;
      loginButton.textContent = 'Sign In';
      return;
    }

    if (session) {
      userEmail.textContent = session.user.email || '';
      showState('signed-in');
      showUploadState('upload');
    }
  } catch (error) {
    console.error('Login error:', error);
    showLoginError('An unexpected error occurred. Please try again.');
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
    resetToUpload();
  } catch (error) {
    console.error('Sign out error:', error);
  } finally {
    signOutButton.disabled = false;
    signOutButton.textContent = 'Sign Out';
  }
});

// ============================================================================
// Initialization
// ============================================================================

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
      showUploadState('upload');
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
      showUploadState('upload');
    } else if (event === 'SIGNED_OUT') {
      showState('login');
      resetToUpload();
    }
  });
}

// Initialize when popup opens
init();
