# Cultivera to Square Chrome Extension

A Chrome extension that creates Square invoices directly from Cultivera PRO order pages.

## Features

- **One-click invoicing**: Click "Send to Square" on any Cultivera order page
- **Secure authentication**: Individual user sessions via Supabase Auth
- **Duplicate prevention**: Multi-layer protection against duplicate invoices
- **Audit logging**: Complete audit trail for compliance
- **Rate limiting**: Protection against accidental loops

## Project Structure

```
cultivera-square-extension/
├── manifest.json           # Chrome extension manifest (v3)
├── package.json            # Node.js dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── esbuild.config.js       # Build configuration
├── src/
│   ├── content.ts          # Content script (button injection, modals)
│   ├── background.ts       # Service worker (auth state, session refresh)
│   ├── lib/
│   │   ├── api.ts          # Edge Function API client
│   │   ├── scraper.ts      # DOM scraping for order data
│   │   ├── storage.ts      # Chrome storage helpers
│   │   ├── supabase.ts     # Supabase client configuration
│   │   └── types.ts        # TypeScript type definitions
│   ├── modal/
│   │   └── modal.css       # Modal and button styles
│   └── popup/
│       ├── popup.html      # Extension popup UI
│       ├── popup.css       # Popup styles
│       └── popup.ts        # Popup logic
├── supabase/
│   ├── functions/
│   │   └── create-square-invoice/
│   │       └── index.ts    # Supabase Edge Function
│   └── migrations/
│       └── 238_cultivera_square_invoicing.sql
├── assets/                 # Extension icons
└── docs/
    ├── OPERATIONS.md       # Operational runbook
    └── TESTING.md          # Testing checklist
```

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Supabase CLI
- Chrome browser

### Installation

1. **Install dependencies**
   ```bash
   cd cultivera-square-extension
   npm install
   ```

2. **Configure Supabase**

   Update `src/lib/supabase.ts` with your Supabase project URL and anon key:
   ```typescript
   const SUPABASE_URL = 'https://your-project.supabase.co';
   const SUPABASE_ANON_KEY = 'your-anon-key';
   ```

3. **Apply database migration**
   ```bash
   supabase db push
   # Or run the SQL manually in Supabase Dashboard
   ```

4. **Deploy Edge Function**
   ```bash
   supabase functions deploy create-square-invoice

   # Set secrets
   supabase secrets set SQUARE_ACCESS_TOKEN=your_square_token
   supabase secrets set SQUARE_LOCATION_ID=your_location_id
   ```

5. **Build the extension**
   ```bash
   npm run build
   ```

6. **Load in Chrome**
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

## Development

### Watch Mode

```bash
npm run watch
```

This will rebuild on file changes. Reload the extension in Chrome to see updates.

### Type Checking

```bash
npm run typecheck
```

### Production Build

```bash
npm run build:prod
```

### Package for Distribution

```bash
npm run package
```

This creates `cultivera-square-extension.zip` for Chrome Web Store upload.

## Configuration

### Environment Variables (Edge Function)

| Variable | Description |
|----------|-------------|
| `SQUARE_ACCESS_TOKEN` | Square API access token with CUSTOMERS_WRITE, ORDERS_WRITE, INVOICES_WRITE scopes |
| `SQUARE_LOCATION_ID` | Your Square location ID |

### DOM Selectors

If Cultivera updates their UI, update the selectors in `src/lib/scraper.ts`:

```typescript
const SELECTORS = {
  orderNumber: ['[data-testid="order-number"]', '.order-number', ...],
  customerName: ['[data-testid="customer-name"]', '.customer-name', ...],
  // ...
};
```

## Authorization

Users must be added to the `authorized_invoicers` table to create invoices:

```sql
INSERT INTO authorized_invoicers (user_id, role, granted_by)
VALUES ('user-uuid', 'invoicer', 'admin-uuid');
```

## Troubleshooting

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for common issues and solutions.

## Testing

See [docs/TESTING.md](docs/TESTING.md) for the complete testing checklist.

## Security

- No secrets stored in the extension
- All API calls authenticated with individual user sessions
- Server-side validation of all inputs
- Rate limiting to prevent abuse
- Complete audit logging

## License

Proprietary - Pure Shenandoah
