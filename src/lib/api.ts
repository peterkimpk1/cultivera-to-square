import { getAccessToken, SUPABASE_URL } from './supabase';
import {
  CreateInvoiceRequest,
  CreateInvoiceResponse,
  OrderStatusResponse,
  ParsedOrderData,
} from './types';

// Edge Function endpoint
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/create-square-invoice`;

/**
 * Create a Square invoice from Cultivera order data
 */
export async function createInvoice(
  orderData: ParsedOrderData
): Promise<CreateInvoiceResponse> {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    return {
      success: false,
      correlation_id: '',
      error: {
        code: 'AUTH_MISSING',
        message: 'Please sign in to use the extension. Click the extension icon to log in.',
      },
    };
  }

  const requestBody: CreateInvoiceRequest = {
    order_number: orderData.order_number,
    customer_name: orderData.customer_name,
    customer_email: orderData.customer_email,
    amount_cents: orderData.amount_cents,
    request_timestamp: new Date().toISOString(),
  };

  try {
    console.log('[API] Sending to:', EDGE_FUNCTION_URL);
    console.log('[API] Request body:', requestBody);
    console.log('[API] Token (first 20 chars):', accessToken?.substring(0, 20));

    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log('[API] Response status:', response.status);
    const data: CreateInvoiceResponse = await response.json();
    console.log('[API] Response data:', data);
    return data;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to connect. Check internet connection.';

    return {
      success: false,
      correlation_id: '',
      error: {
        code: 'INTERNAL_ERROR',
        message: `Network error: ${message}`,
      },
    };
  }
}

/**
 * Check if an order has already been processed
 */
export async function checkOrderStatus(
  orderNumber: string
): Promise<OrderStatusResponse> {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    return { exists: false };
  }

  try {
    // Use Supabase RPC to check order status
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_processed_order`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: accessToken,
        },
        body: JSON.stringify({ check_order_number: orderNumber }),
      }
    );

    if (!response.ok) {
      return { exists: false };
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      return { exists: false };
    }

    const order = data[0];
    return {
      exists: true,
      order_number: order.order_number,
      status: order.status,
      square_invoice_id: order.square_invoice_id,
      completed_at: order.completed_at,
      customer_name: order.customer_name,
      amount_cents: order.amount_cents,
    };
  } catch {
    return { exists: false };
  }
}

/**
 * Format currency amount from cents
 */
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

/**
 * Get user-friendly error message based on error code
 */
export function getErrorMessage(code: string, defaultMessage: string): string {
  const errorMessages: Record<string, string> = {
    AUTH_MISSING:
      'Please sign in to use the extension. Click the extension icon to log in.',
    AUTH_INVALID: 'Your session is invalid. Please sign in again.',
    AUTH_EXPIRED: 'Your session has expired. Please sign in again.',
    UNAUTHORIZED:
      'Your account is not authorized to create invoices. Contact your admin for access.',
    VALIDATION_MISSING_FIELD:
      'Some required information is missing. Please check the order details.',
    VALIDATION_INVALID_EMAIL:
      'No valid email found. Add email to Cultivera customer profile under Delivery Preferences.',
    VALIDATION_INVALID_AMOUNT:
      'Amount appears invalid (negative or exceeds maximum). Verify the order total in Cultivera.',
    VALIDATION_INVALID_ORDER:
      'Invalid order number format. Please verify the order in Cultivera.',
    DUPLICATE_ORDER:
      'Invoice already sent for this order. View in Square Dashboard.',
    RATE_LIMITED_USER:
      'Too many requests. Please wait a few minutes before trying again.',
    RATE_LIMITED_GLOBAL:
      'System is busy. Please wait a few minutes before trying again.',
    REPLAY_REJECTED: 'Request expired. Please try again.',
    SQUARE_API_ERROR: 'Square error. Try again or contact admin.',
    SQUARE_CUSTOMER_ERROR:
      'Could not create or find customer in Square. Please try again.',
    SQUARE_ORDER_ERROR:
      'Could not create order in Square. Please try again.',
    SQUARE_INVOICE_ERROR:
      'Could not create invoice in Square. Please try again.',
    SQUARE_PUBLISH_ERROR:
      'Invoice created but could not be sent. Check Square Dashboard.',
    INTERNAL_ERROR: 'An unexpected error occurred. Please try again.',
  };

  return errorMessages[code] || defaultMessage;
}
