// ============================================================================
// Request/Response Types
// ============================================================================

export interface CreateInvoiceRequest {
  order_number: string;
  customer_name: string;
  customer_email: string;
  amount_cents: number;
  request_timestamp: string; // ISO 8601 timestamp for replay protection
}

export interface CreateInvoiceResponse {
  success: boolean;
  correlation_id: string;
  data?: {
    square_customer_id: string;
    square_order_id: string;
    square_invoice_id: string;
    invoice_number: string;
  };
  error?: {
    code: ErrorCode;
    message: string;
    retry_after?: number; // seconds until retry is allowed (for rate limiting)
  };
}

export interface OrderStatusResponse {
  exists: boolean;
  order_number?: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  square_invoice_id?: string;
  completed_at?: string;
  customer_name?: string;
  amount_cents?: number;
}

// ============================================================================
// Error Codes
// ============================================================================

export type ErrorCode =
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
// Scraped Data Types
// ============================================================================

export interface ScrapedOrderData {
  order_number: string;
  customer_name: string;
  customer_email: string;
  amount_due: string; // Raw string from PDF (e.g., "$1,234.56")
}

// ============================================================================
// PDF Parsing Types
// ============================================================================

export interface PDFParseResult {
  success: boolean;
  data?: ScrapedOrderData;
  errors: string[];
  warnings: string[];
  rawText?: string;
}

export interface ParsedOrderData {
  order_number: string;
  customer_name: string;
  customer_email: string;
  amount_cents: number;
}

// ============================================================================
// Database Row Types
// ============================================================================

export interface AuthorizedInvoicer {
  id: string;
  user_id: string;
  role: 'invoicer' | 'auditor';
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessedOrder {
  id: string;
  order_number: string;
  user_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  square_customer_id: string | null;
  square_order_id: string | null;
  square_invoice_id: string | null;
  steps_completed: string[];
  amount_cents: number;
  customer_name: string;
  customer_email: string;
  idempotency_key: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface InvoiceAuditLog {
  id: string;
  correlation_id: string;
  timestamp: string;
  user_id: string | null;
  user_email: string | null;
  cultivera_order_number: string | null;
  customer_name: string | null;
  customer_email: string | null;
  amount_cents: number | null;
  idempotency_key: string | null;
  square_customer_id: string | null;
  square_order_id: string | null;
  square_invoice_id: string | null;
  result: AuditResult;
  error_code: string | null;
  error_message: string | null;
  request_timestamp: string | null;
  steps_completed: string[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type AuditResult =
  | 'SUCCESS'
  | 'FAILURE'
  | 'DUPLICATE_BLOCKED'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'AUTH_MISSING'
  | 'RATE_LIMITED'
  | 'REPLAY_REJECTED';

// ============================================================================
// Session Types
// ============================================================================

export interface UserSession {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp
  user: {
    id: string;
    email: string;
  };
}

// ============================================================================
// UI State Types
// ============================================================================

export interface ModalState {
  isOpen: boolean;
  type: 'confirmation' | 'result' | 'error';
  data?: ParsedOrderData;
  result?: CreateInvoiceResponse;
  isLoading?: boolean;
}

export interface ButtonState {
  isDisabled: boolean;
  isLoading: boolean;
  text: string;
  status: 'ready' | 'loading' | 'success' | 'error' | 'already-sent';
}
