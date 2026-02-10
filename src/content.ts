import {
  isOrderPage,
  scrapeOrderData,
  parseOrderData,
  findButtonInjectionPoint,
  getValidationErrors,
  parseCurrencyToCents,
} from './lib/scraper';
import { createInvoice, checkOrderStatus, formatCurrency, getErrorMessage } from './lib/api';
import { isAuthenticated, getAccessToken } from './lib/supabase';
import { addToLocalLog } from './lib/storage';
import { ParsedOrderData, CreateInvoiceResponse } from './lib/types';

// ============================================================================
// Constants
// ============================================================================

const BUTTON_ID = 'cultivera-square-send-btn';
const MODAL_OVERLAY_ID = 'cultivera-square-overlay';

// ============================================================================
// Button State Management
// ============================================================================

let buttonState: 'ready' | 'loading' | 'success' | 'error' | 'already-sent' = 'ready';

function getButton(): HTMLButtonElement | null {
  return document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
}

function updateButtonState(
  state: typeof buttonState,
  text?: string
): void {
  buttonState = state;
  const button = getButton();
  if (!button) return;

  button.disabled = state === 'loading' || state === 'success' || state === 'already-sent';

  button.classList.remove('success', 'error');
  if (state === 'success' || state === 'already-sent') {
    button.classList.add('success');
  } else if (state === 'error') {
    button.classList.add('error');
  }

  if (text) {
    button.innerHTML = getButtonContent(state, text);
  } else {
    button.innerHTML = getButtonContent(state);
  }
}

function getButtonContent(state: typeof buttonState, customText?: string): string {
  const squareIcon = `<svg class="cultivera-square-icon" viewBox="0 0 24 24" fill="currentColor">
    <path d="M21 3H3C1.9 3 1 3.9 1 5V19C1 20.1 1.9 21 3 21H21C22.1 21 23 20.1 23 19V5C23 3.9 22.1 3 21 3ZM21 19H3V5H21V19Z"/>
  </svg>`;

  const spinner = `<span class="cultivera-square-spinner"></span>`;
  const checkIcon = `<svg class="cultivera-square-icon" viewBox="0 0 24 24" fill="currentColor">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
  </svg>`;

  switch (state) {
    case 'loading':
      return `${spinner} ${customText || 'Sending...'}`;
    case 'success':
      return `${checkIcon} ${customText || 'Invoice Sent'}`;
    case 'already-sent':
      return `${checkIcon} ${customText || 'Already Sent'}`;
    case 'error':
      return `${squareIcon} ${customText || 'Try Again'}`;
    default:
      return `${squareIcon} ${customText || 'Send to Square'}`;
  }
}

// ============================================================================
// Modal Creation
// ============================================================================

function createModal(
  type: 'confirmation' | 'success' | 'error',
  data?: ParsedOrderData,
  result?: CreateInvoiceResponse
): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.id = MODAL_OVERLAY_ID;
  overlay.className = 'cultivera-square-overlay';

  const modal = document.createElement('div');
  modal.className = 'cultivera-square-modal';

  if (type === 'confirmation' && data) {
    modal.innerHTML = `
      <div class="cultivera-square-modal-header">
        <h2 class="cultivera-square-modal-title">Confirm Invoice Details</h2>
        <button class="cultivera-square-modal-close" data-action="close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="cultivera-square-modal-body">
        <div class="cultivera-square-order-details">
          <div class="cultivera-square-detail-row">
            <span class="cultivera-square-detail-label">Order Number</span>
            <span class="cultivera-square-detail-value">#${data.order_number}</span>
          </div>
          <div class="cultivera-square-detail-row">
            <span class="cultivera-square-detail-label">Customer</span>
            <span class="cultivera-square-detail-value">${escapeHtml(data.customer_name)}</span>
          </div>
          <div class="cultivera-square-detail-row">
            <span class="cultivera-square-detail-label">Email</span>
            <span class="cultivera-square-detail-value">${escapeHtml(data.customer_email)}</span>
          </div>
          <div class="cultivera-square-detail-row">
            <span class="cultivera-square-detail-label">Amount</span>
            <span class="cultivera-square-detail-value amount">${formatCurrency(data.amount_cents)}</span>
          </div>
        </div>
        <div class="cultivera-square-info">
          <p class="cultivera-square-info-text">
            A Net 30 invoice will be created in Square and emailed to the customer.
          </p>
        </div>
      </div>
      <div class="cultivera-square-modal-footer">
        <button class="cultivera-square-btn cultivera-square-btn-secondary" data-action="cancel">
          Cancel
        </button>
        <button class="cultivera-square-btn cultivera-square-btn-primary" data-action="confirm">
          Send Invoice
        </button>
      </div>
    `;
  } else if (type === 'success' && result?.data) {
    modal.innerHTML = `
      <div class="cultivera-square-modal-header">
        <h2 class="cultivera-square-modal-title">Invoice Sent</h2>
        <button class="cultivera-square-modal-close" data-action="close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="cultivera-square-modal-body">
        <div class="cultivera-square-success">
          <div class="cultivera-square-success-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </div>
          <h3 class="cultivera-square-success-title">Invoice Created Successfully</h3>
          <p class="cultivera-square-success-message">
            Invoice #${result.data.invoice_number} has been emailed to the customer.
          </p>
        </div>
      </div>
      <div class="cultivera-square-modal-footer">
        <button class="cultivera-square-btn cultivera-square-btn-success" data-action="close">
          Done
        </button>
      </div>
    `;
  } else if (type === 'error') {
    const errorMessage = result?.error
      ? getErrorMessage(result.error.code, result.error.message)
      : 'An unexpected error occurred.';

    modal.innerHTML = `
      <div class="cultivera-square-modal-header">
        <h2 class="cultivera-square-modal-title">Error</h2>
        <button class="cultivera-square-modal-close" data-action="close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="cultivera-square-modal-body">
        <div class="cultivera-square-error">
          <div class="cultivera-square-error-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
          </div>
          <h3 class="cultivera-square-error-title">Invoice Not Sent</h3>
          <p class="cultivera-square-error-message">${escapeHtml(errorMessage)}</p>
        </div>
      </div>
      <div class="cultivera-square-modal-footer">
        <button class="cultivera-square-btn cultivera-square-btn-secondary" data-action="close">
          Close
        </button>
      </div>
    `;
  }

  overlay.appendChild(modal);
  return overlay;
}

function showModal(modal: HTMLDivElement): Promise<'confirm' | 'cancel' | 'close'> {
  return new Promise((resolve) => {
    document.body.appendChild(modal);

    const handleClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const action = target.closest('[data-action]')?.getAttribute('data-action');

      if (action === 'confirm' || action === 'cancel' || action === 'close') {
        modal.removeEventListener('click', handleClick);
        closeModal();
        resolve(action as 'confirm' | 'cancel' | 'close');
      }

      // Close on overlay click
      if (target === modal) {
        modal.removeEventListener('click', handleClick);
        closeModal();
        resolve('close');
      }
    };

    modal.addEventListener('click', handleClick);
  });
}

function closeModal(): void {
  const modal = document.getElementById(MODAL_OVERLAY_ID);
  if (modal) {
    modal.remove();
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// Main Logic
// ============================================================================

async function handleSendToSquare(): Promise<void> {
  // Check authentication
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    showNotAuthenticatedModal();
    return;
  }

  // Scrape order data
  const scraped = scrapeOrderData();
  const errors = getValidationErrors(scraped);

  if (errors.length > 0 || !scraped) {
    const modal = createModal('error', undefined, {
      success: false,
      correlation_id: '',
      error: {
        code: 'VALIDATION_MISSING_FIELD',
        message: errors.join(' '),
      },
    });
    await showModal(modal);
    updateButtonState('error');
    return;
  }

  // Parse the scraped data
  const parsedData = parseOrderData(scraped);
  if (!parsedData) {
    const modal = createModal('error', undefined, {
      success: false,
      correlation_id: '',
      error: {
        code: 'VALIDATION_INVALID_AMOUNT',
        message: 'Could not parse order amount. Please verify the order in Cultivera.',
      },
    });
    await showModal(modal);
    updateButtonState('error');
    return;
  }

  // Check if order was already processed
  const orderStatus = await checkOrderStatus(parsedData.order_number);
  if (orderStatus.exists && orderStatus.status === 'completed') {
    const modal = createModal('error', undefined, {
      success: false,
      correlation_id: '',
      error: {
        code: 'DUPLICATE_ORDER',
        message: `Invoice already sent for order #${parsedData.order_number}. View in Square Dashboard.`,
      },
    });
    await showModal(modal);
    updateButtonState('already-sent');
    return;
  }

  // Show confirmation modal
  const confirmModal = createModal('confirmation', parsedData);
  const action = await showModal(confirmModal);

  if (action !== 'confirm') {
    return;
  }

  // Send to Square
  updateButtonState('loading', 'Creating Invoice...');

  const result = await createInvoice(parsedData);

  // Log to local storage
  await addToLocalLog({
    orderNumber: parsedData.order_number,
    action: 'create_invoice',
    success: result.success,
    message: result.success
      ? `Invoice ${result.data?.invoice_number} created`
      : result.error?.message,
  });

  if (result.success && result.data) {
    updateButtonState('success');
    const successModal = createModal('success', parsedData, result);
    await showModal(successModal);
  } else {
    updateButtonState('error');
    const errorModal = createModal('error', parsedData, result);
    await showModal(errorModal);
  }
}

function showNotAuthenticatedModal(): void {
  const overlay = document.createElement('div');
  overlay.id = MODAL_OVERLAY_ID;
  overlay.className = 'cultivera-square-overlay';

  const modal = document.createElement('div');
  modal.className = 'cultivera-square-modal';
  modal.innerHTML = `
    <div class="cultivera-square-modal-header">
      <h2 class="cultivera-square-modal-title">Sign In Required</h2>
    </div>
    <div class="cultivera-square-modal-body">
      <div class="cultivera-square-error">
        <div class="cultivera-square-error-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h3 class="cultivera-square-error-title">Please Sign In</h3>
        <p class="cultivera-square-error-message">
          Click the Cultivera to Square extension icon in your browser toolbar to sign in.
        </p>
      </div>
    </div>
    <div class="cultivera-square-modal-footer">
      <button class="cultivera-square-btn cultivera-square-btn-secondary" data-action="close">
        Close
      </button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-action="close"]') || target === overlay) {
      overlay.remove();
    }
  });
}

// ============================================================================
// Button Injection
// ============================================================================

function injectButton(): void {
  // Don't inject if button already exists
  if (getButton()) {
    return;
  }

  // Only inject on order pages
  if (!isOrderPage()) {
    return;
  }

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.className = 'cultivera-square-send-btn';
  button.innerHTML = getButtonContent('ready');

  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (buttonState === 'loading' || buttonState === 'success' || buttonState === 'already-sent') {
      return;
    }

    handleSendToSquare();
  });

  // Try to find injection point
  const injectionPoint = findButtonInjectionPoint();

  if (injectionPoint) {
    injectionPoint.appendChild(button);
  } else {
    // Fallback: inject at the top of the page content
    const mainContent =
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('.content') ||
      document.body.firstElementChild;

    if (mainContent) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'padding: 12px; background: #f9fafb; border-bottom: 1px solid #e5e7eb;';
      wrapper.appendChild(button);
      mainContent.insertBefore(wrapper, mainContent.firstChild);
    } else {
      document.body.prepend(button);
    }
  }

  // Check if this order was already processed
  checkExistingOrder();
}

async function checkExistingOrder(): Promise<void> {
  const scraped = scrapeOrderData();
  if (!scraped) return;

  const status = await checkOrderStatus(scraped.order_number);
  if (status.exists && status.status === 'completed') {
    updateButtonState('already-sent');
  }
}

function removeButton(): void {
  const button = getButton();
  if (button) {
    // Remove the wrapper if it was added
    const wrapper = button.parentElement;
    if (wrapper && wrapper.children.length === 1) {
      wrapper.remove();
    } else {
      button.remove();
    }
  }
}

// ============================================================================
// SPA Navigation Handling
// ============================================================================

let lastUrl = location.href;

function checkForPageChange(): void {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    buttonState = 'ready';

    if (isOrderPage()) {
      // Small delay to let the page render
      setTimeout(injectButton, 500);
    } else {
      removeButton();
    }
  }
}

// Watch for URL changes (SPA navigation)
const observer = new MutationObserver(() => {
  checkForPageChange();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Also check on popstate (back/forward navigation)
window.addEventListener('popstate', () => {
  setTimeout(checkForPageChange, 100);
});

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'AUTH_STATE_CHANGED') {
    if (!message.signedIn) {
      // User signed out, reset button state
      buttonState = 'ready';
      const button = getButton();
      if (button) {
        updateButtonState('ready');
      }
    } else {
      // User signed in, check if we need to update the button
      checkExistingOrder();
    }
  }
});

// ============================================================================
// Initialization
// ============================================================================

function init(): void {
  // Wait for page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(injectButton, 500);
    });
  } else {
    setTimeout(injectButton, 500);
  }
}

init();

console.log('[Cultivera to Square] Content script loaded');
