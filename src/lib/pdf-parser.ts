import * as pdfjsLib from 'pdfjs-dist';
import { ScrapedOrderData, ParsedOrderData, PDFParseResult } from './types';

// Configure pdf.js worker for Chrome extension environment
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');

// ============================================================================
// Constants
// ============================================================================

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// ============================================================================
// PDF Text Extraction
// ============================================================================

/**
 * Extract text content from all pages of a PDF file
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const textParts: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    textParts.push(pageText);
  }

  return textParts.join('\n');
}

// ============================================================================
// PDF Validation
// ============================================================================

/**
 * Validate that the file is a valid PDF and appears to be a Cultivera invoice
 */
export function validatePDF(file: File): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check file type
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    errors.push('Please upload a PDF file.');
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    errors.push(`File size exceeds ${MAX_FILE_SIZE_MB}MB limit.`);
  }

  if (file.size === 0) {
    errors.push('File is empty.');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if the PDF text appears to be a Cultivera invoice
 */
function isCultiveraInvoice(text: string): boolean {
  const cultiveraIndicators = [
    /cultivera/i,
    /invoice/i,
    /order\s*#/i,
    /ship\s*to/i,
    /amount\s*due/i,
    /manifest/i,
    /license\s*#/i,
  ];

  // Need at least 3 indicators to consider it a valid invoice
  let matches = 0;
  for (const pattern of cultiveraIndicators) {
    if (pattern.test(text)) {
      matches++;
    }
  }

  return matches >= 3;
}

// ============================================================================
// Data Parsing
// ============================================================================

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
 * Extract order number from PDF text
 */
function extractOrderNumber(text: string): string | null {
  // Try multiple patterns for order number
  // PDF text extraction may put value before or after label depending on layout
  const patterns = [
    // Value after label: "Order #: 7600"
    /Order\s*#\s*:?\s*(\d+)/i,
    /Order\s*#[:\s]+(\d+)/i,
    /Order\s*Number[:\s]+(\d+)/i,
    // Value before label (common in columnar PDFs): "7600 Order #"
    /(\d+)\s+Order\s*#/i,
    /(\d+)\s+Order\s*Number/i,
    // PO patterns
    /PO\s*#[:\s]+(\d+)/i,
    /(\d+)\s+PO\s*#/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Extract customer name from PDF text (typically from Ship To section)
 */
function extractCustomerName(text: string): string | null {
  // In Cultivera PDFs, "Ship To" and "Manifest Details" are column headers
  // The customer name often appears after "Manifest #:" due to PDF extraction order
  // Try multiple patterns

  // Pattern 1: Look for text between "Ship To" and common delimiters
  const shipToPatterns = [
    // Direct extraction after Ship To
    /Ship\s*To\s+([\w\s]+?)(?=\s{2,}|Manifest|License|Phone|harrisonburg|$)/i,
    // After Manifest #: (common in columnar PDFs)
    /Manifest\s*#:\s*([\w\s]+?)(?=\s{2,}\d|\s+0\s|Plate|Vehicle|$)/i,
  ];

  for (const pattern of shipToPatterns) {
    const match = text.match(pattern);
    if (match) {
      let name = match[1].trim();

      // Skip if it's just numbers or too short
      if (name.length < 2 || /^\d+$/.test(name)) {
        continue;
      }

      // Skip if it looks like an address (starts with numbers followed by street)
      if (/^\d+\s+(N|S|E|W|North|South|East|West|\w+\s+(St|Ave|Rd|Blvd|Dr|Ln))/i.test(name)) {
        continue;
      }

      // Clean up: remove city/state/zip patterns
      name = name.replace(/,?\s*(VA|CA|NY|TX|FL|[A-Z]{2})\s*\d{5}(-\d{4})?$/i, '').trim();

      // Validate final name
      if (name.length >= 2 && name.length < 100) {
        return name;
      }
    }
  }

  return null;
}

/**
 * Extract customer email from PDF text
 */
function extractCustomerEmail(text: string): string | null {
  // Find all email patterns in the text
  const emailPattern = /[\w.-]+@[\w.-]+\.[a-z]{2,}/gi;
  const emails = text.match(emailPattern);

  if (emails && emails.length > 0) {
    // Filter out common system/no-reply emails
    const validEmails = emails.filter(email => {
      const lower = email.toLowerCase();
      return !lower.includes('noreply') &&
             !lower.includes('no-reply') &&
             !lower.includes('cultivera.com') &&
             !lower.includes('example.com');
    });

    return validEmails.length > 0 ? validEmails[0] : emails[0];
  }

  return null;
}

/**
 * Extract amount due from PDF text
 */
function extractAmountDue(text: string): string | null {
  // Try multiple patterns for amount due
  // PDF extraction may put value before or after label
  const patterns = [
    // Value after label: "Amount Due: $32.50"
    /Amount\s*Due[:\s]*\$?([\d,]+\.?\d*)/i,
    /Total\s*Due[:\s]*\$?([\d,]+\.?\d*)/i,
    /Balance\s*Due[:\s]*\$?([\d,]+\.?\d*)/i,
    // Value before label: "$32.50 Amount Due"
    /\$([\d,]+\.?\d*)\s+Amount\s*Due/i,
    /\$([\d,]+\.?\d*)\s+Total\s*Due/i,
    /\$([\d,]+\.?\d*)\s+Balance\s*Due/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = match[1];
      // Validate it looks like a reasonable amount
      const numericAmount = parseFloat(amount.replace(/,/g, ''));
      if (!isNaN(numericAmount) && numericAmount > 0) {
        return `$${amount}`;
      }
    }
  }

  return null;
}

// ============================================================================
// Main Parsing Function
// ============================================================================

/**
 * Parse a Cultivera invoice PDF and extract order data
 */
export async function parseCultiveraInvoice(file: File): Promise<PDFParseResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate file first
  const validation = validatePDF(file);
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors,
      warnings: [],
    };
  }

  try {
    // Extract text from PDF
    const rawText = await extractTextFromPDF(file);

    // Check if it's a Cultivera invoice
    if (!isCultiveraInvoice(rawText)) {
      return {
        success: false,
        errors: ['This does not appear to be a Cultivera invoice PDF. Please upload a Cultivera purchase order.'],
        warnings: [],
        rawText,
      };
    }

    // Extract data fields
    const order_number = extractOrderNumber(rawText);
    const customer_name = extractCustomerName(rawText);
    const customer_email = extractCustomerEmail(rawText);
    const amount_due = extractAmountDue(rawText);

    // Validate extracted data
    if (!order_number) {
      errors.push('Could not find order number in PDF.');
    }

    if (!customer_name) {
      errors.push('Could not find customer name in PDF.');
    }

    if (!customer_email) {
      errors.push('No customer email found in PDF. Please add email to Cultivera customer profile.');
    } else if (!customer_email.includes('@')) {
      errors.push('Invalid email format found in PDF.');
    }

    if (!amount_due) {
      errors.push('Could not find amount due in PDF.');
    } else {
      const cents = parseCurrencyToCents(amount_due);
      if (cents === null || cents <= 0) {
        errors.push('Amount appears invalid (negative or zero).');
      } else if (cents > 5000000) {
        errors.push('Amount exceeds $50,000 maximum. Contact admin for large orders.');
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        errors,
        warnings,
        rawText,
      };
    }

    // All required fields extracted successfully
    const data: ScrapedOrderData = {
      order_number: order_number!,
      customer_name: customer_name!,
      customer_email: customer_email!,
      amount_due: amount_due!,
    };

    return {
      success: true,
      data,
      errors: [],
      warnings,
      rawText,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      errors: [`Failed to parse PDF: ${message}`],
      warnings: [],
    };
  }
}

/**
 * Parse scraped data into the format needed for the API
 */
export function parseOrderData(scraped: ScrapedOrderData): ParsedOrderData | null {
  const amount_cents = parseCurrencyToCents(scraped.amount_due);

  if (amount_cents === null || amount_cents <= 0) {
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
 * Get validation errors for scraped data
 */
export function getValidationErrors(scraped: ScrapedOrderData | null): string[] {
  const errors: string[] = [];

  if (!scraped) {
    errors.push('Unable to parse order data from PDF.');
    return errors;
  }

  if (!scraped.order_number) {
    errors.push('Could not find order number.');
  }

  if (!scraped.customer_name) {
    errors.push('Could not find customer name.');
  }

  if (!scraped.customer_email) {
    errors.push('No email found. Add email to Cultivera customer profile under Delivery Preferences.');
  } else if (!scraped.customer_email.includes('@')) {
    errors.push('Invalid email format detected.');
  }

  if (!scraped.amount_due) {
    errors.push('Could not parse amount due.');
  } else {
    const cents = parseCurrencyToCents(scraped.amount_due);
    if (cents === null || cents <= 0) {
      errors.push('Amount appears invalid (negative or zero).');
    } else if (cents > 5000000) {
      errors.push('Amount exceeds $50,000 maximum. Contact admin for large orders.');
    }
  }

  return errors;
}
