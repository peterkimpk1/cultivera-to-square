import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// ============================================================================
// Types
// ============================================================================

interface CreateInvoiceRequest {
  order_number: string;
  customer_name: string;
  customer_email: string;
  amount_cents: number;
  request_timestamp: string;
}

interface SquareCustomer {
  id: string;
  email_address?: string;
  given_name?: string;
  family_name?: string;
}

interface SquareError {
  category: string;
  code: string;
  detail: string;
}

type ErrorCode =
  | 'AUTH_MISSING'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_MISSING_FIELD'
  | 'VALIDATION_INVALID_EMAIL'
  | 'VALIDATION_INVALID_AMOUNT'
  | 'VALIDATION_INVALID_ORDER'
  | 'DUPLICATE_ORDER'
  | 'RATE_LIMITED_USER'
  | 'RATE_LIMITED_GLOBAL'
  | 'REPLAY_REJECTED'
  | 'SQUARE_API_ERROR'
  | 'SQUARE_CUSTOMER_ERROR'
  | 'SQUARE_ORDER_ERROR'
  | 'SQUARE_INVOICE_ERROR'
  | 'SQUARE_PUBLISH_ERROR'
  | 'INTERNAL_ERROR';

// ============================================================================
// Constants
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const REPLAY_WINDOW_SECONDS = 120;
const MAX_AMOUNT_CENTS = 5000000; // $50,000
const USER_RATE_LIMIT = 10; // per hour
const GLOBAL_RATE_LIMIT = 50; // per hour
const SQUARE_API_VERSION = '2024-01-18';

// Use sandbox for testing, production for live
// Set SQUARE_ENVIRONMENT=sandbox or SQUARE_ENVIRONMENT=production
const SQUARE_BASE_URL = Deno.env.get('SQUARE_ENVIRONMENT') === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

// ============================================================================
// Helper Functions
// ============================================================================

function generateCorrelationId(): string {
  return crypto.randomUUID();
}

function jsonResponse(
  data: unknown,
  status: number = 200,
  correlationId?: string
): Response {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'Content-Type': 'application/json',
  };
  if (correlationId) {
    headers['X-Correlation-ID'] = correlationId;
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  correlationId: string,
  retryAfter?: number
): Response {
  const body: Record<string, unknown> = {
    success: false,
    correlation_id: correlationId,
    error: { code, message },
  };
  if (retryAfter) {
    (body.error as Record<string, unknown>).retry_after = retryAfter;
  }
  return jsonResponse(body, status, correlationId);
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidOrderNumber(orderNumber: string): boolean {
  // Order numbers should be alphanumeric, possibly with dashes
  const orderRegex = /^[A-Za-z0-9-]+$/;
  return orderRegex.test(orderNumber) && orderNumber.length > 0 && orderNumber.length <= 50;
}

function calculateDueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30); // Net 30
  return date.toISOString().split('T')[0]; // YYYY-MM-DD format
}

// ============================================================================
// Supabase Client
// ============================================================================

function createSupabaseClient(serviceRoleKey: string, supabaseUrl: string) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// ============================================================================
// Square API Functions
// ============================================================================

async function squareRequest(
  endpoint: string,
  method: string,
  body: unknown,
  accessToken: string,
  idempotencyKey?: string
): Promise<{ data?: unknown; errors?: SquareError[] }> {
  const headers: Record<string, string> = {
    'Square-Version': SQUARE_API_VERSION,
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const response = await fetch(`${SQUARE_BASE_URL}/v2${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  return response.json();
}

async function searchCustomerByEmail(
  email: string,
  accessToken: string
): Promise<SquareCustomer | null> {
  const result = await squareRequest(
    '/customers/search',
    'POST',
    {
      query: {
        filter: {
          email_address: {
            exact: email,
          },
        },
      },
    },
    accessToken
  );

  if (result.errors) {
    throw new Error(`Customer search failed: ${result.errors[0]?.detail}`);
  }

  const customers = (result.data as { customers?: SquareCustomer[] })?.customers;
  return customers && customers.length > 0 ? customers[0] : null;
}

async function createCustomer(
  name: string,
  email: string,
  orderNumber: string,
  accessToken: string
): Promise<SquareCustomer> {
  const nameParts = name.trim().split(/\s+/);
  const givenName = nameParts[0] || '';
  const familyName = nameParts.slice(1).join(' ') || '';

  const result = await squareRequest(
    '/customers',
    'POST',
    {
      idempotency_key: `cust-${orderNumber}`,
      given_name: givenName,
      family_name: familyName,
      email_address: email,
    },
    accessToken,
    `cust-${orderNumber}`
  );

  if (result.errors) {
    throw new Error(`Customer creation failed: ${result.errors[0]?.detail}`);
  }

  return (result as { customer: SquareCustomer }).customer;
}

async function createOrder(
  customerId: string,
  amountCents: number,
  orderNumber: string,
  locationId: string,
  accessToken: string
): Promise<string> {
  const result = await squareRequest(
    '/orders',
    'POST',
    {
      idempotency_key: `ord-${orderNumber}`,
      order: {
        location_id: locationId,
        customer_id: customerId,
        reference_id: orderNumber,
        line_items: [
          {
            name: `Wholesale Order #${orderNumber}`,
            quantity: '1',
            base_price_money: {
              amount: amountCents,
              currency: 'USD',
            },
          },
        ],
      },
    },
    accessToken,
    `ord-${orderNumber}`
  );

  if (result.errors) {
    throw new Error(`Order creation failed: ${result.errors[0]?.detail}`);
  }

  return (result as { order: { id: string } }).order.id;
}

async function createInvoice(
  orderId: string,
  customerId: string,
  orderNumber: string,
  locationId: string,
  accessToken: string
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const dueDate = calculateDueDate();

  const result = await squareRequest(
    '/invoices',
    'POST',
    {
      idempotency_key: `inv-${orderNumber}`,
      invoice: {
        order_id: orderId,
        location_id: locationId,
        primary_recipient: {
          customer_id: customerId,
        },
        payment_requests: [
          {
            request_type: 'BALANCE',
            due_date: dueDate,
            automatic_payment_source: 'NONE',
          },
        ],
        accepted_payment_methods: {
          card: true,
          square_gift_card: false,
          bank_account: true,
          buy_now_pay_later: false,
          cash_app_pay: false,
        },
        delivery_method: 'EMAIL',
        title: `Invoice for Order #${orderNumber}`,
      },
    },
    accessToken,
    `inv-${orderNumber}`
  );

  if (result.errors) {
    throw new Error(`Invoice creation failed: ${result.errors[0]?.detail}`);
  }

  const invoice = (result as { invoice: { id: string; invoice_number: string } }).invoice;
  return { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number };
}

async function publishInvoice(
  invoiceId: string,
  orderNumber: string,
  accessToken: string
): Promise<void> {
  // First get the current invoice version
  const getResult = await squareRequest(
    `/invoices/${invoiceId}`,
    'GET',
    null,
    accessToken
  );

  if (getResult.errors) {
    throw new Error(`Failed to get invoice: ${getResult.errors[0]?.detail}`);
  }

  const version = (getResult as { invoice: { version: number } }).invoice.version;

  const result = await squareRequest(
    `/invoices/${invoiceId}/publish`,
    'POST',
    {
      idempotency_key: `pub-${orderNumber}`,
      version,
    },
    accessToken,
    `pub-${orderNumber}`
  );

  if (result.errors) {
    throw new Error(`Invoice publish failed: ${result.errors[0]?.detail}`);
  }
}

// ============================================================================
// Audit Logging
// ============================================================================

async function logAudit(
  supabase: ReturnType<typeof createClient>,
  correlationId: string,
  data: {
    user_id?: string;
    user_email?: string;
    cultivera_order_number?: string;
    customer_name?: string;
    customer_email?: string;
    amount_cents?: number;
    idempotency_key?: string;
    square_customer_id?: string;
    square_order_id?: string;
    square_invoice_id?: string;
    result: string;
    error_code?: string;
    error_message?: string;
    request_timestamp?: string;
    steps_completed?: string[];
  }
): Promise<void> {
  try {
    await supabase.from('invoice_audit_log').insert({
      correlation_id: correlationId,
      ...data,
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

// ============================================================================
// Main Handler
// ============================================================================

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const correlationId = generateCorrelationId();

  // Only allow POST
  if (req.method !== 'POST') {
    return errorResponse('INTERNAL_ERROR', 'Method not allowed', 405, correlationId);
  }

  // Get environment variables
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const squareAccessToken = Deno.env.get('SQUARE_ACCESS_TOKEN');
  const squareLocationId = Deno.env.get('SQUARE_LOCATION_ID');

  if (!supabaseUrl || !supabaseServiceKey || !squareAccessToken || !squareLocationId) {
    console.error('Missing required environment variables');
    return errorResponse('INTERNAL_ERROR', 'Server configuration error', 500, correlationId);
  }

  const supabase = createSupabaseClient(supabaseServiceKey, supabaseUrl);

  // ============================================================================
  // 1. Authentication
  // ============================================================================
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    await logAudit(supabase, correlationId, {
      result: 'AUTH_MISSING',
      error_code: 'AUTH_MISSING',
      error_message: 'No authorization header provided',
    });
    return errorResponse('AUTH_MISSING', 'Authentication required', 401, correlationId);
  }

  const jwt = authHeader.replace('Bearer ', '');

  // Validate the user's JWT using the service role client
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);

  if (authError || !user) {
    await logAudit(supabase, correlationId, {
      result: 'AUTH_MISSING',
      error_code: authError?.message?.includes('expired') ? 'AUTH_EXPIRED' : 'AUTH_INVALID',
      error_message: authError?.message || 'Invalid authentication token',
    });

    const code = authError?.message?.includes('expired') ? 'AUTH_EXPIRED' : 'AUTH_INVALID';
    const message = code === 'AUTH_EXPIRED' ? 'Session expired. Please sign in again.' : 'Invalid authentication';
    return errorResponse(code, message, 401, correlationId);
  }

  // ============================================================================
  // 2. Authorization
  // ============================================================================
  const { data: isAuthorized } = await supabase.rpc('is_authorized_invoicer', {
    p_user_id: user.id,
  });

  if (!isAuthorized) {
    await logAudit(supabase, correlationId, {
      user_id: user.id,
      user_email: user.email,
      result: 'UNAUTHORIZED',
      error_code: 'UNAUTHORIZED',
      error_message: 'User is not authorized to create invoices',
    });
    return errorResponse(
      'UNAUTHORIZED',
      'Your account is not authorized to create invoices. Contact your admin for access.',
      403,
      correlationId
    );
  }

  // ============================================================================
  // 3. Parse Request Body
  // ============================================================================
  let body: CreateInvoiceRequest;
  try {
    body = await req.json();
  } catch {
    await logAudit(supabase, correlationId, {
      user_id: user.id,
      user_email: user.email,
      result: 'VALIDATION_FAILED',
      error_code: 'VALIDATION_MISSING_FIELD',
      error_message: 'Invalid JSON body',
    });
    return errorResponse('VALIDATION_MISSING_FIELD', 'Invalid request body', 400, correlationId);
  }

  const { order_number, customer_name, customer_email, amount_cents, request_timestamp } = body;

  // ============================================================================
  // 4. Validation
  // ============================================================================

  // Required fields
  if (!order_number || !customer_name || !customer_email || amount_cents === undefined || !request_timestamp) {
    const missingFields = [];
    if (!order_number) missingFields.push('order_number');
    if (!customer_name) missingFields.push('customer_name');
    if (!customer_email) missingFields.push('customer_email');
    if (amount_cents === undefined) missingFields.push('amount_cents');
    if (!request_timestamp) missingFields.push('request_timestamp');

    await logAudit(supabase, correlationId, {
      user_id: user.id,
      user_email: user.email,
      cultivera_order_number: order_number,
      result: 'VALIDATION_FAILED',
      error_code: 'VALIDATION_MISSING_FIELD',
      error_message: `Missing required fields: ${missingFields.join(', ')}`,
    });
    return errorResponse(
      'VALIDATION_MISSING_FIELD',
      `Missing required fields: ${missingFields.join(', ')}`,
      400,
      correlationId
    );
  }

  // Order number format
  if (!isValidOrderNumber(order_number)) {
    await logAudit(supabase, correlationId, {
      user_id: user.id,
      user_email: user.email,
      cultivera_order_number: order_number,
      result: 'VALIDATION_FAILED',
      error_code: 'VALIDATION_INVALID_ORDER',
      error_message: 'Invalid order number format',
    });
    return errorResponse('VALIDATION_INVALID_ORDER', 'Invalid order number format', 400, correlationId);
  }

  // Email format
  if (!isValidEmail(customer_email)) {
    await logAudit(supabase, correlationId, {
      user_id: user.id,
      user_email: user.email,
      cultivera_order_number: order_number,
      customer_email,
      result: 'VALIDATION_FAILED',
      error_code: 'VALIDATION_INVALID_EMAIL',
      error_message: 'Invalid email format',
    });
    return errorResponse('VALIDATION_INVALID_EMAIL', 'Invalid customer email format', 400, correlationId);
  }

  // Amount validation
  if (!Number.isInteger(amount_cents) || amount_cents <= 0 || amount_cents > MAX_AMOUNT_CENTS) {
    await logAudit(supabase, correlationId, {
      user_id: user.id,
      user_email: user.email,
      cultivera_order_number: order_number,
      amount_cents,
      result: 'VALIDATION_FAILED',
      error_code: 'VALIDATION_INVALID_AMOUNT',
      error_message: `Amount must be a positive integer not exceeding ${MAX_AMOUNT_CENTS} cents`,
    });
    return errorResponse(
      'VALIDATION_INVALID_AMOUNT',
      'Amount appears invalid (must be positive and not exceed $50,000)',
      400,
      correlationId
    );
  }

  // ============================================================================
  // 5. Replay Protection
  // ============================================================================
  const requestTime = new Date(request_timestamp).getTime();
  const now = Date.now();
  const ageSeconds = (now - requestTime) / 1000;

  if (isNaN(requestTime) || ageSeconds > REPLAY_WINDOW_SECONDS || ageSeconds < -30) {
    await logAudit(supabase, correlationId, {
      user_id: user.id,
      user_email: user.email,
      cultivera_order_number: order_number,
      request_timestamp,
      result: 'REPLAY_REJECTED',
      error_code: 'REPLAY_REJECTED',
      error_message: `Request timestamp outside acceptable window (${ageSeconds.toFixed(1)}s old)`,
    });
    return errorResponse('REPLAY_REJECTED', 'Request expired. Please try again.', 400, correlationId);
  }

  // ============================================================================
  // 6. Rate Limiting
  // ============================================================================
  const { data: userRateCount } = await supabase.rpc('get_user_rate_limit_count', {
    check_user_id: user.id,
  });

  if (userRateCount >= USER_RATE_LIMIT) {
    await logAudit(supabase, correlationId, {
      user_id: user.id,
      user_email: user.email,
      cultivera_order_number: order_number,
      result: 'RATE_LIMITED',
      error_code: 'RATE_LIMITED_USER',
      error_message: `User rate limit exceeded: ${userRateCount}/${USER_RATE_LIMIT} per hour`,
    });
    return errorResponse(
      'RATE_LIMITED_USER',
      'Too many requests. Please wait before trying again.',
      429,
      correlationId,
      3600 // 1 hour
    );
  }

  const { data: globalRateCount } = await supabase.rpc('get_global_rate_limit_count');

  if (globalRateCount >= GLOBAL_RATE_LIMIT) {
    await logAudit(supabase, correlationId, {
      user_id: user.id,
      user_email: user.email,
      cultivera_order_number: order_number,
      result: 'RATE_LIMITED',
      error_code: 'RATE_LIMITED_GLOBAL',
      error_message: `Global rate limit exceeded: ${globalRateCount}/${GLOBAL_RATE_LIMIT} per hour`,
    });
    return errorResponse(
      'RATE_LIMITED_GLOBAL',
      'System is busy. Please wait a few minutes before trying again.',
      429,
      correlationId,
      300 // 5 minutes
    );
  }

  // ============================================================================
  // 7. Duplicate Check
  // ============================================================================
  const { data: existingOrder } = await supabase
    .from('processed_orders')
    .select('*')
    .eq('order_number', order_number)
    .single();

  if (existingOrder && existingOrder.status === 'completed') {
    await logAudit(supabase, correlationId, {
      user_id: user.id,
      user_email: user.email,
      cultivera_order_number: order_number,
      square_invoice_id: existingOrder.square_invoice_id,
      result: 'DUPLICATE_BLOCKED',
      error_code: 'DUPLICATE_ORDER',
      error_message: `Order already processed on ${existingOrder.completed_at}`,
    });
    return errorResponse(
      'DUPLICATE_ORDER',
      `Invoice already sent for order #${order_number}. View in Square Dashboard.`,
      409,
      correlationId
    );
  }

  // ============================================================================
  // 8. Create/Update Processed Order Record
  // ============================================================================
  const idempotencyKey = `cultivera-${order_number}`;
  const stepsCompleted: string[] = [];

  let processedOrderId: string;

  if (existingOrder) {
    // Resume from existing record
    processedOrderId = existingOrder.id;
    await supabase
      .from('processed_orders')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', processedOrderId);
  } else {
    // Create new record
    const { data: newOrder, error: insertError } = await supabase
      .from('processed_orders')
      .insert({
        order_number,
        user_id: user.id,
        status: 'processing',
        amount_cents,
        customer_name,
        customer_email,
        idempotency_key: idempotencyKey,
      })
      .select('id')
      .single();

    if (insertError) {
      // Check if it's a unique constraint violation (race condition)
      if (insertError.code === '23505') {
        await logAudit(supabase, correlationId, {
          user_id: user.id,
          user_email: user.email,
          cultivera_order_number: order_number,
          result: 'DUPLICATE_BLOCKED',
          error_code: 'DUPLICATE_ORDER',
          error_message: 'Order being processed by another request',
        });
        return errorResponse(
          'DUPLICATE_ORDER',
          'This order is already being processed. Please wait a moment.',
          409,
          correlationId
        );
      }
      throw insertError;
    }

    processedOrderId = newOrder.id;
  }

  // ============================================================================
  // 9. Square API Orchestration
  // ============================================================================
  let squareCustomerId: string | undefined;
  let squareOrderId: string | undefined;
  let squareInvoiceId: string | undefined;
  let invoiceNumber: string | undefined;

  try {
    // Step 1: Search for existing customer
    const existingCustomer = await searchCustomerByEmail(customer_email, squareAccessToken);
    stepsCompleted.push('customer_search');

    // Step 2: Create customer if not found
    if (existingCustomer) {
      squareCustomerId = existingCustomer.id;
      stepsCompleted.push('customer_found');
    } else {
      const newCustomer = await createCustomer(customer_name, customer_email, order_number, squareAccessToken);
      squareCustomerId = newCustomer.id;
      stepsCompleted.push('customer_created');
    }

    // Update progress
    await supabase
      .from('processed_orders')
      .update({ square_customer_id: squareCustomerId, steps_completed: stepsCompleted })
      .eq('id', processedOrderId);

    // Step 3: Create order
    squareOrderId = await createOrder(squareCustomerId, amount_cents, order_number, squareLocationId, squareAccessToken);
    stepsCompleted.push('order_created');

    await supabase
      .from('processed_orders')
      .update({ square_order_id: squareOrderId, steps_completed: stepsCompleted })
      .eq('id', processedOrderId);

    // Step 4: Create invoice
    const invoiceResult = await createInvoice(squareOrderId, squareCustomerId, order_number, squareLocationId, squareAccessToken);
    squareInvoiceId = invoiceResult.invoiceId;
    invoiceNumber = invoiceResult.invoiceNumber;
    stepsCompleted.push('invoice_created');

    await supabase
      .from('processed_orders')
      .update({ square_invoice_id: squareInvoiceId, steps_completed: stepsCompleted })
      .eq('id', processedOrderId);

    // Step 5: Publish invoice
    await publishInvoice(squareInvoiceId, order_number, squareAccessToken);
    stepsCompleted.push('invoice_published');

    // Mark as completed
    await supabase
      .from('processed_orders')
      .update({
        status: 'completed',
        steps_completed: stepsCompleted,
        completed_at: new Date().toISOString(),
      })
      .eq('id', processedOrderId);

    // Log success
    await logAudit(supabase, correlationId, {
      user_id: user.id,
      user_email: user.email,
      cultivera_order_number: order_number,
      customer_name,
      customer_email,
      amount_cents,
      idempotency_key: idempotencyKey,
      square_customer_id: squareCustomerId,
      square_order_id: squareOrderId,
      square_invoice_id: squareInvoiceId,
      result: 'SUCCESS',
      request_timestamp,
      steps_completed: stepsCompleted,
    });

    return jsonResponse(
      {
        success: true,
        correlation_id: correlationId,
        data: {
          square_customer_id: squareCustomerId,
          square_order_id: squareOrderId,
          square_invoice_id: squareInvoiceId,
          invoice_number: invoiceNumber,
        },
      },
      200,
      correlationId
    );
  } catch (error) {
    // Determine error type based on last step
    let errorCode: ErrorCode = 'SQUARE_API_ERROR';
    if (stepsCompleted.length === 0) {
      errorCode = 'SQUARE_CUSTOMER_ERROR';
    } else if (!stepsCompleted.includes('order_created')) {
      errorCode = 'SQUARE_ORDER_ERROR';
    } else if (!stepsCompleted.includes('invoice_created')) {
      errorCode = 'SQUARE_INVOICE_ERROR';
    } else if (!stepsCompleted.includes('invoice_published')) {
      errorCode = 'SQUARE_PUBLISH_ERROR';
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Update processed order with failure
    await supabase
      .from('processed_orders')
      .update({
        status: 'failed',
        steps_completed: stepsCompleted,
        error_message: errorMessage,
        square_customer_id: squareCustomerId,
        square_order_id: squareOrderId,
        square_invoice_id: squareInvoiceId,
      })
      .eq('id', processedOrderId);

    // Log failure
    await logAudit(supabase, correlationId, {
      user_id: user.id,
      user_email: user.email,
      cultivera_order_number: order_number,
      customer_name,
      customer_email,
      amount_cents,
      idempotency_key: idempotencyKey,
      square_customer_id: squareCustomerId,
      square_order_id: squareOrderId,
      square_invoice_id: squareInvoiceId,
      result: 'FAILURE',
      error_code: errorCode,
      error_message: errorMessage,
      request_timestamp,
      steps_completed: stepsCompleted,
    });

    return errorResponse(
      errorCode,
      `Invoice creation did not complete. Click 'Try Again' to retry safely. Error: ${errorMessage}`,
      500,
      correlationId
    );
  }
});
