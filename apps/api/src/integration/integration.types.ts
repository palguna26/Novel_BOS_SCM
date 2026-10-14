export type IntegrationQuery = {
  limit?: string;
  cursor?: string;
  updatedAfter?: string;
  active?: string;
  status?: string;
  stockStatus?: string;
  channelId?: string;
  siteId?: string;
  locationId?: string;
  itemId?: string;
  purchaseOrderId?: string;
  shipmentId?: string;
  identifierType?: string;
  value?: string;
  from?: string;
  to?: string;
};

export type IntegrationContext = {
  companyId: string;
  scopes: Set<string>;
  clientId: string;
};

export type Page<T> = {
  data: T[];
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
  meta: { requestId: string; asOf: string };
};

export const READ_SCOPES = [
  'master:read',
  'inventory:read',
  'po:read',
  'fulfilment:read',
  'movement:read',
  'finance:read',
  'planning:read',
] as const;
