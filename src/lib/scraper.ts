import { ScrapedOrderData, ParsedOrderData } from './types';

/**
 * DOM Scraper for Cultivera PRO order pages.
 *
 * IMPORTANT: These selectors are based on the expected Cultivera PRO DOM structure.
 * If Cultivera updates their UI, these selectors may need to be updated.
 *
 * To update selectors:
 * 1. Navigate to an order page in Cultivera PRO
 * 2. Right-click and inspect each field
 * 3. Update the selectors below
 * 4. Test with multiple orders to ensure reliability
 */

// ============================================================================
// Selectors Configuration
// ============================================================================

const SELECTORS = {
  // Indicators that we're on an order page
  orderPageIndicators: [
    '[data-testid="order-detail"]',
    '.order-detail-page',
    '#order-detail',
    '.order-header', // Common pattern for order pages
  ],

  // Order number selectors (try in order)
  orderNumber: [
    '[data-testid="order-number"]',
    '.order-number',
    '#order-number',
    'h1.order-title', // Often contains "Order #XXXX"
    '.order-header h1',
    '[class*="orderNumber"]',
    '[class*="order-number"]',
  ],

  // Customer name selectors
  customerName: [
    '[data-testid="customer-name"]',
    '.customer-name',
    '#customer-name',
    '[class*="customerName"]',
    '.customer-info .name',
    '.delivery-info .customer',
  ],

  // Customer email selectors
  customerEmail: [
    '[data-testid="customer-email"]',
    '.customer-email',
    '#customer-email',
    '[class*="customerEmail"]',
    '.customer-info .email',
    'a[href^="mailto:"]',
    '[type="email"]',
  ],

  // Amount due selectors
  amountDue: [
    '[data-testid="amount-due"]',
    '[data-testid="total-amount"]',
    '.amount-due',
    '.total-amount',
    '#amount-due',
    '[class*="amountDue"]',
    '[class*="totalAmount"]',
    '.order-total',
    '.balance-due',
  ],

  // Button injection point (where to add the Send to Square button)
  buttonInjectionPoint: [
    '[data-testid="order-actions"]',
    '.order-actions',
    '.action-buttons',
    '.order-header-actions',
    '.order-detail-header',
  ],
};

// ============================================================================
// Page Detection
// ============================================================================

/**
 * Check if we're currently on a Cultivera order page
 */
export function isOrderPage(): boolean {
  // Check URL patterns
  const url = window.location.href;
  const isOrderUrl =
    url.includes('/order/') ||
    url.includes('/orders/') ||
    url.includes('/invoice/') ||
    url.includes('orderId=') ||
    url.includes('order_id=');

  if (!isOrderUrl) {
    return false;
  }

  // Check for order page indicators in DOM
  for (const selector of SELECTORS.orderPageIndicators) {
    if (document.querySelector(selector)) {
      return true;
    }
  }

  // Fallback: check if we can find an order number
  const orderNumber = findElement(SELECTORS.orderNumber);
  return orderNumber !== null;
}

// ============================================================================
// Element Finding Helpers
// ============================================================================

/**
 * Find an element using multiple selectors
 */
function findElement(selectors: string[]): Element | null {
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    } catch {
      // Invalid selector, skip
    }
  }
  return null;
}

/**
 * Get text content from an element, trimmed and cleaned
 */
function getElementText(element: Element | null): string {
  if (!element) {
    return '';
  }
  return (element.textContent || '').trim().replace(/\s+/g, ' ');
}

// ============================================================================
// Data Extraction
// ============================================================================

/**
 * Extract order number from the page
 */
function extractOrderNumber(): string | null {
  const element = findElement(SELECTORS.orderNumber);
  const text = getElementText(element);

  if (!text) {
    return null;
  }

  // Try to extract just the number from text like "Order #1234" or "Invoice 1234"
  const match = text.match(/(?:order|invoice|#)\s*#?\s*(\d+)/i) || text.match(/(\d+)/);
  return match ? match[1] : text;
}

/**
 * Extract customer name from the page
 */
function extractCustomerName(): string | null {
  const element = findElement(SELECTORS.customerName);
  const text = getElementText(element);
  return text || null;
}

/**
 * Extract customer email from the page
 */
function extractCustomerEmail(): string | null {
  // First try specific email selectors
  const element = findElement(SELECTORS.customerEmail);

  if (element) {
    // Check if it's a mailto link
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') || '';
      const match = href.match(/mailto:([^\?]+)/);
      if (match) {
        return match[1].trim();
      }
    }

    const text = getElementText(element);
    // Validate it looks like an email
    if (text.includes('@')) {
      return text;
    }
  }

  // Fallback: scan the page for email patterns
  const pageText = document.body.innerText;
  const emailMatch = pageText.match(/[\w.-]+@[\w.-]+\.\w+/);
  return emailMatch ? emailMatch[0] : null;
}

/**
 * Extract amount due from the page
 */
function extractAmountDue(): string | null {
  const element = findElement(SELECTORS.amountDue);
  const text = getElementText(element);

  if (!text) {
    return null;
  }

  // Try to find a currency amount in the text
  const match = text.match(/\$[\d,]+\.?\d*/);
  return match ? match[0] : text;
}

// ============================================================================
// Main Scraping Functions
// ============================================================================

/**
 * Scrape all order data from the current page
 */
export function scrapeOrderData(): ScrapedOrderData | null {
  const order_number = extractOrderNumber();
  const customer_name = extractCustomerName();
  const customer_email = extractCustomerEmail();
  const amount_due = extractAmountDue();

  // All fields are required
  if (!order_number || !customer_name || !customer_email || !amount_due) {
    console.warn('[Cultivera Scraper] Missing required fields:', {
      order_number: !!order_number,
      customer_name: !!customer_name,
      customer_email: !!customer_email,
      amount_due: !!amount_due,
    });
    return null;
  }

  return {
    order_number,
    customer_name,
    customer_email,
    amount_due,
  };
}

/**
 * Parse a currency string to cents
 * Examples: "$1,234.56" -> 123456, "$100" -> 10000
 */
export function parseCurrencyToCents(currencyStr: string): number | null {
  // Remove currency symbol, commas, and whitespace
  const cleaned = currencyStr.replace(/[$,\s]/g, '');

  // Parse as float
  const amount = parseFloat(cleaned);

  if (isNaN(amount) || amount < 0) {
    return null;
  }

  // Convert to cents (multiply by 100 and round to avoid floating point issues)
  return Math.round(amount * 100);
}

/**
 * Parse scraped data into the format needed for the API
 */
export function parseOrderData(scraped: ScrapedOrderData): ParsedOrderData | null {
  const amount_cents = parseCurrencyToCents(scraped.amount_due);

  if (amount_cents === null || amount_cents <= 0) {
    console.warn('[Cultivera Scraper] Invalid amount:', scraped.amount_due);
    return null;
  }

  return {
    order_number: scraped.order_number,
    customer_name: scraped.customer_name,
    customer_email: scraped.customer_email,
    amount_cents,
  };
}

/**
 * Find the best element to inject the "Send to Square" button
 */
export function findButtonInjectionPoint(): Element | null {
  return findElement(SELECTORS.buttonInjectionPoint);
}

/**
 * Get validation errors for scraped data
 */
export function getValidationErrors(scraped: ScrapedOrderData | null): string[] {
  const errors: string[] = [];

  if (!scraped) {
    errors.push('Unable to read order data from page. The page structure may have changed.');
    return errors;
  }

  if (!scraped.order_number) {
    errors.push('Could not find order number on page.');
  }

  if (!scraped.customer_name) {
    errors.push('Could not find customer name on page.');
  }

  if (!scraped.customer_email) {
    errors.push('No email found. Add email to Cultivera customer profile under Delivery Preferences.');
  } else if (!scraped.customer_email.includes('@')) {
    errors.push('Invalid email format detected.');
  }

  if (!scraped.amount_due) {
    errors.push('Could not parse amount due. Verify Amount Due is visible on the order page.');
  } else {
    const cents = parseCurrencyToCents(scraped.amount_due);
    if (cents === null || cents <= 0) {
      errors.push('Amount appears invalid (negative or zero). Verify the order total in Cultivera.');
    } else if (cents > 5000000) {
      errors.push('Amount exceeds $50,000 maximum. Contact admin for large orders.');
    }
  }

  return errors;
}
