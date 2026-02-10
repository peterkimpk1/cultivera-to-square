-- Migration 238: Cultivera Square Invoicing Tables
-- Creates tables for authorized invoicers, processed orders, and audit logging

-- ============================================================================
-- Table: authorized_invoicers
-- ============================================================================
-- Tracks which users are authorized to create Square invoices
CREATE TABLE IF NOT EXISTS public.authorized_invoicers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('invoicer', 'auditor')),
    granted_by UUID NOT NULL REFERENCES auth.users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active role per user (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_invoicer
    ON public.authorized_invoicers(user_id)
    WHERE revoked_at IS NULL;

-- Index for quick authorization lookups
CREATE INDEX IF NOT EXISTS idx_authorized_invoicers_user_id
    ON public.authorized_invoicers(user_id) WHERE (revoked_at IS NULL);

-- RLS policies for authorized_invoicers
ALTER TABLE public.authorized_invoicers ENABLE ROW LEVEL SECURITY;

-- Users can view their own authorization status
CREATE POLICY "Users can view own authorization"
    ON public.authorized_invoicers
    FOR SELECT
    USING (auth.uid() = user_id);

-- Admins can manage all authorizations (you may need to adjust this based on your admin role)
CREATE POLICY "Admins can manage authorizations"
    ON public.authorized_invoicers
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.authorized_invoicers ai
            WHERE ai.user_id = auth.uid()
            AND ai.role = 'auditor'
            AND ai.revoked_at IS NULL
        )
    );

-- ============================================================================
-- Table: processed_orders
-- ============================================================================
-- Tracks orders that have been processed to prevent duplicates
CREATE TABLE IF NOT EXISTS public.processed_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    square_customer_id TEXT,
    square_order_id TEXT,
    square_invoice_id TEXT,
    steps_completed JSONB DEFAULT '[]'::jsonb,
    amount_cents INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    -- Prevent duplicate processing of the same order
    CONSTRAINT unique_order_number UNIQUE (order_number)
);

-- Index for order lookups
CREATE INDEX IF NOT EXISTS idx_processed_orders_order_number
    ON public.processed_orders(order_number);

CREATE INDEX IF NOT EXISTS idx_processed_orders_user_id
    ON public.processed_orders(user_id);

CREATE INDEX IF NOT EXISTS idx_processed_orders_status
    ON public.processed_orders(status);

-- RLS policies for processed_orders
ALTER TABLE public.processed_orders ENABLE ROW LEVEL SECURITY;

-- Authorized invoicers can view all processed orders
CREATE POLICY "Authorized invoicers can view processed orders"
    ON public.processed_orders
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.authorized_invoicers ai
            WHERE ai.user_id = auth.uid()
            AND ai.revoked_at IS NULL
        )
    );

-- Only the Edge Function (service role) can insert/update processed orders
-- This is handled by the service role key used by the Edge Function

-- ============================================================================
-- Table: invoice_audit_log
-- ============================================================================
-- Comprehensive audit log for all invoice actions
CREATE TABLE IF NOT EXISTS public.invoice_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id UUID REFERENCES auth.users(id),
    user_email TEXT,
    cultivera_order_number TEXT,
    customer_name TEXT,
    customer_email TEXT,
    amount_cents INTEGER,
    idempotency_key TEXT,
    square_customer_id TEXT,
    square_order_id TEXT,
    square_invoice_id TEXT,
    result TEXT NOT NULL CHECK (result IN (
        'SUCCESS',
        'FAILURE',
        'DUPLICATE_BLOCKED',
        'VALIDATION_FAILED',
        'UNAUTHORIZED',
        'AUTH_MISSING',
        'RATE_LIMITED',
        'REPLAY_REJECTED'
    )),
    error_code TEXT,
    error_message TEXT,
    request_timestamp TIMESTAMPTZ,
    steps_completed JSONB,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for audit log queries
CREATE INDEX IF NOT EXISTS idx_invoice_audit_log_correlation_id
    ON public.invoice_audit_log(correlation_id);

CREATE INDEX IF NOT EXISTS idx_invoice_audit_log_user_id
    ON public.invoice_audit_log(user_id);

CREATE INDEX IF NOT EXISTS idx_invoice_audit_log_order_number
    ON public.invoice_audit_log(cultivera_order_number);

CREATE INDEX IF NOT EXISTS idx_invoice_audit_log_timestamp
    ON public.invoice_audit_log(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_audit_log_result
    ON public.invoice_audit_log(result);

-- RLS policies for invoice_audit_log
ALTER TABLE public.invoice_audit_log ENABLE ROW LEVEL SECURITY;

-- Auditors can view all audit logs
CREATE POLICY "Auditors can view audit logs"
    ON public.invoice_audit_log
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.authorized_invoicers ai
            WHERE ai.user_id = auth.uid()
            AND ai.revoked_at IS NULL
        )
    );

-- Only the Edge Function (service role) can insert audit logs
-- This is handled by the service role key used by the Edge Function

-- ============================================================================
-- Helper RPC Functions
-- ============================================================================

-- Check if a user is authorized to create invoices
CREATE OR REPLACE FUNCTION public.is_authorized_invoicer(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.authorized_invoicers
        WHERE user_id = check_user_id
        AND role = 'invoicer'
        AND revoked_at IS NULL
    );
END;
$$;

-- Check if an order has already been processed
CREATE OR REPLACE FUNCTION public.was_order_processed(check_order_number TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.processed_orders
        WHERE order_number = check_order_number
        AND status = 'completed'
    );
END;
$$;

-- Get processed order details
CREATE OR REPLACE FUNCTION public.get_processed_order(check_order_number TEXT)
RETURNS TABLE (
    order_number TEXT,
    status TEXT,
    square_invoice_id TEXT,
    completed_at TIMESTAMPTZ,
    customer_name TEXT,
    amount_cents INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        po.order_number,
        po.status,
        po.square_invoice_id,
        po.completed_at,
        po.customer_name,
        po.amount_cents
    FROM public.processed_orders po
    WHERE po.order_number = check_order_number;
END;
$$;

-- Get rate limit count for a user in the last hour
CREATE OR REPLACE FUNCTION public.get_user_rate_limit_count(check_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    count_result INTEGER;
BEGIN
    SELECT COUNT(*) INTO count_result
    FROM public.invoice_audit_log
    WHERE user_id = check_user_id
    AND timestamp > NOW() - INTERVAL '1 hour'
    AND result IN ('SUCCESS', 'FAILURE');

    RETURN count_result;
END;
$$;

-- Get global rate limit count in the last hour
CREATE OR REPLACE FUNCTION public.get_global_rate_limit_count()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    count_result INTEGER;
BEGIN
    SELECT COUNT(*) INTO count_result
    FROM public.invoice_audit_log
    WHERE timestamp > NOW() - INTERVAL '1 hour'
    AND result IN ('SUCCESS', 'FAILURE');

    RETURN count_result;
END;
$$;

-- Grant execute permissions on helper functions
GRANT EXECUTE ON FUNCTION public.is_authorized_invoicer(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.was_order_processed(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_processed_order(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_rate_limit_count(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_global_rate_limit_count() TO service_role;

-- ============================================================================
-- Trigger for updating updated_at timestamps
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER update_authorized_invoicers_updated_at
    BEFORE UPDATE ON public.authorized_invoicers
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_processed_orders_updated_at
    BEFORE UPDATE ON public.processed_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
