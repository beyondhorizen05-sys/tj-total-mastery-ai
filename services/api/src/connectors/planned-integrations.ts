import type { ConnectorRuntime } from './sdk.js';
import { field, httpJson, manifest } from './sdk.js';

const isoDateTime = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO UTC timestamp ending in Z`);
  }
  return value;
};

async function graphToken(config: Record<string, string>) {
  const tenant = config.tenant_id?.trim();
  if (!tenant || !/^[A-Za-z0-9.-]{1,253}$/.test(tenant) || tenant.startsWith('.') || tenant.includes('..')) throw new Error('Microsoft tenant ID/domain is invalid');
  const body = new URLSearchParams({
    client_id: config.client_id,
    client_secret: config.client_secret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const token = await httpJson(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, timeoutMs: 12000,
  });
  if (typeof token?.access_token !== 'string' || !token.access_token) throw new Error('Microsoft identity returned no access token');
  return token.access_token as string;
}

function graphUser(config: Record<string, string>) {
  const user = config.user_id?.trim();
  if (!user || user.length > 256 || !/^[A-Za-z0-9._@-]+$/.test(user)) throw new Error('Microsoft 365 user ID or UPN is invalid');
  return encodeURIComponent(user);
}

async function graph(config: Record<string, string>, path: string) {
  const token = await graphToken(config);
  return httpJson(`https://graph.microsoft.com/v1.0${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, timeoutMs: 15000 });
}

export const microsoft365: ConnectorRuntime = {
  manifest: manifest({
    id: 'microsoft365', name: 'Microsoft 365 (Outlook/Calendar)', icon: '▦', provider: 'Microsoft Graph', category: 'productivity',
    description: 'Read a selected Microsoft 365 user’s calendar events and email metadata through Microsoft Graph.',
    docs_url: 'https://learn.microsoft.com/en-us/graph/auth-v2-service', auth_scheme: 'oauth2',
    permissions: ['network.http', 'connector.use'], scopes: ['User.Read.All (application)', 'Calendars.Read (application)', 'Mail.Read (application)'],
    privacy: 'Read-only Graph access for the configured user. Requires an Entra app registration, admin consent, and least-privilege Microsoft Graph application permissions. The client secret is encrypted in TJ’s local vault.',
    config_fields: [
      field('tenant_id', 'Tenant ID or domain', false, true, 'Microsoft Entra tenant ID or verified tenant domain.'),
      field('client_id', 'Application (client) ID', false, true),
      field('client_secret', 'Client secret value', true, true, 'Use the secret value, not the secret ID.'),
      field('user_id', 'User ID or UPN', false, true, 'Example: alex@contoso.com. Access remains limited by the app’s granted Graph permissions.'),
    ],
    actions: [
      { id: 'list_events', name: 'List calendar events', description: 'Read events in a bounded UTC time window (up to 31 days).', input_schema: { type: 'object', properties: { start_datetime: { type: 'string' }, end_datetime: { type: 'string' } }, required: ['start_datetime', 'end_datetime'] }, risk: 'low' },
      { id: 'list_messages', name: 'List email metadata', description: 'Read recent message headers and short previews; does not send mail.', input_schema: { type: 'object', properties: { top: { type: 'integer', minimum: 1, maximum: 50 } } }, risk: 'low' },
    ],
  }),
  async test(config) {
    try {
      const user = graphUser(config);
      const result = await graph(config, `/users/${user}?$select=id,displayName`);
      return { ok: true, detail: `Microsoft Graph connected${result.displayName ? ` · ${String(result.displayName).slice(0, 100)}` : ''}` };
    } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : 'Microsoft Graph connection failed' }; }
  },
  actions: {
    list_events: async (config, input) => {
      const start = isoDateTime(input.start_datetime, 'start_datetime');
      const end = isoDateTime(input.end_datetime, 'end_datetime');
      const duration = Date.parse(end) - Date.parse(start);
      if (duration <= 0 || duration > 31 * 24 * 60 * 60 * 1000) throw new Error('Calendar range must be positive and no longer than 31 days');
      return graph(config, `/users/${graphUser(config)}/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=50&$select=id,subject,start,end,location,organizer`);
    },
    list_messages: async (config, input) => {
      const top = input.top === undefined ? 20 : Number(input.top);
      if (!Number.isInteger(top) || top < 1 || top > 50) throw new Error('top must be an integer from 1 to 50');
      return graph(config, `/users/${graphUser(config)}/messages?$top=${top}&$select=id,subject,from,receivedDateTime,isRead,bodyPreview`);
    },
  },
};

function shopDomain(config: Record<string, string>) {
  const domain = config.shop_domain?.trim().toLowerCase();
  if (!domain || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) throw new Error('Shopify domain must be your-store.myshopify.com');
  return domain;
}

async function shopifyGraphql(config: Record<string, string>, query: string, variables: Record<string, unknown> = {}) {
  const domain = shopDomain(config);
  const result = await httpJson(`https://${domain}/admin/api/2026-10/graphql.json`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': config.access_token },
    body: JSON.stringify({ query, variables }), timeoutMs: 15000,
  });
  if (Array.isArray(result?.errors) && result.errors.length) throw new Error(`Shopify GraphQL rejected the request: ${String(result.errors[0]?.message ?? 'unknown error').slice(0, 240)}`);
  if (!result?.data) throw new Error('Shopify returned no GraphQL data');
  return result.data;
}

export const shopify: ConnectorRuntime = {
  manifest: manifest({
    id: 'shopify', name: 'Shopify', icon: '🛍️', provider: 'Shopify Admin API', category: 'business',
    description: 'Connect a Shopify store and read shop, product, and order data through the Admin GraphQL API.',
    docs_url: 'https://shopify.dev/docs/api/admin-graphql/latest', auth_scheme: 'bearer',
    permissions: ['network.http', 'connector.use'], scopes: ['read_products', 'read_orders (optional)'],
    privacy: 'Read-only Shopify Admin API integration. Use a store custom app token with only the read scopes you need; the token is encrypted in TJ’s local vault.',
    config_fields: [field('shop_domain', 'Shop domain', false, true, 'Enter the .myshopify.com domain, not a custom storefront URL.', 'your-store.myshopify.com'), field('access_token', 'Admin API access token', true, true, 'Create or install an app for your store with read_products and, if needed, read_orders.')],
    actions: [
      { id: 'shop_info', name: 'Read shop profile', description: 'Return the connected store name and domain.', input_schema: { type: 'object', properties: {} }, risk: 'low' },
      { id: 'list_products', name: 'List products', description: 'Read up to 50 products.', input_schema: { type: 'object', properties: { first: { type: 'integer', minimum: 1, maximum: 50 } } }, risk: 'low' },
      { id: 'list_orders', name: 'List orders', description: 'Read up to 50 recent orders; requires read_orders.', input_schema: { type: 'object', properties: { first: { type: 'integer', minimum: 1, maximum: 50 } } }, risk: 'low' },
    ],
  }),
  async test(config) {
    try {
      const data = await shopifyGraphql(config, 'query { shop { name myshopifyDomain } }');
      return { ok: true, detail: `Shopify connected · ${String(data.shop?.name ?? data.shop?.myshopifyDomain ?? 'store').slice(0, 100)}` };
    } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : 'Shopify connection failed' }; }
  },
  actions: {
    shop_info: (config) => shopifyGraphql(config, 'query { shop { name myshopifyDomain currencyCode ianaTimezone } }'),
    list_products: async (config, input) => {
      const first = input.first === undefined ? 20 : Number(input.first);
      if (!Number.isInteger(first) || first < 1 || first > 50) throw new Error('first must be an integer from 1 to 50');
      return shopifyGraphql(config, 'query($first:Int!){ products(first:$first, sortKey: UPDATED_AT, reverse:true) { edges { node { id title handle status updatedAt } } pageInfo { hasNextPage endCursor } } }', { first });
    },
    list_orders: async (config, input) => {
      const first = input.first === undefined ? 20 : Number(input.first);
      if (!Number.isInteger(first) || first < 1 || first > 50) throw new Error('first must be an integer from 1 to 50');
      return shopifyGraphql(config, 'query($first:Int!){ orders(first:$first, sortKey: PROCESSED_AT, reverse:true) { edges { node { id name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } } } } pageInfo { hasNextPage endCursor } } }', { first });
    },
  },
};

const alpacaBase = 'https://paper-api.alpaca.markets';
async function alpaca(config: Record<string, string>, path: string) {
  return httpJson(`${alpacaBase}${path}`, { headers: { 'APCA-API-KEY-ID': config.key_id, 'APCA-API-SECRET-KEY': config.secret_key, accept: 'application/json' }, timeoutMs: 15000 });
}

export const alpacaPaper: ConnectorRuntime = {
  manifest: manifest({
    id: 'alpaca', name: 'Alpaca (paper trading)', icon: '📈', provider: 'Alpaca Paper Trading', category: 'finance',
    description: 'Connect to Alpaca’s paper-trading account for read-only account, positions, and order status.',
    docs_url: 'https://docs.alpaca.markets/docs/authentication-1', auth_scheme: 'api_key',
    permissions: ['network.http', 'connector.use'], scopes: ['paper account read', 'positions read', 'orders read'],
    privacy: 'Requests are hardcoded to Alpaca’s paper API host; live trading credentials and live endpoints are not supported by this connector. Read-only actions do not submit orders.',
    config_fields: [field('key_id', 'Paper API key ID', false, true), field('secret_key', 'Paper API secret key', true, true)],
    actions: [
      { id: 'account', name: 'Read paper account', description: 'Read paper account status and balances.', input_schema: { type: 'object', properties: {} }, risk: 'low' },
      { id: 'positions', name: 'List paper positions', description: 'Read current paper positions.', input_schema: { type: 'object', properties: {} }, risk: 'low' },
      { id: 'orders', name: 'List paper orders', description: 'Read recent paper orders; does not submit or change orders.', input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } }, risk: 'low' },
    ],
  }),
  async test(config) {
    try {
      const account = await alpaca(config, '/v2/account');
      return { ok: true, detail: `Paper account connected · status ${String(account.status ?? 'available')}` };
    } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : 'Alpaca paper connection failed' }; }
  },
  actions: {
    account: (config) => alpaca(config, '/v2/account'),
    positions: (config) => alpaca(config, '/v2/positions'),
    orders: (config, input) => {
      const limit = input.limit === undefined ? 20 : Number(input.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit must be an integer from 1 to 50');
      return alpaca(config, `/v2/orders?status=all&direction=desc&limit=${limit}`);
    },
  },
};
