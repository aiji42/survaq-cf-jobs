import { BasePerformer } from './base-performer';
import { Env } from '../../worker-configuration';
import SqlString from 'sqlstring';

export class Logiless extends BasePerformer {
  private logiless: LogilessAPIClient;
  constructor(ctx: ExecutionContext, env: Env) {
    super(ctx, env);
    this.logiless = new LogilessAPIClient(env.KV, env.LOGILESS_CLIENT_ID, env.LOGILESS_CLIENT_SECRET);
  }

  async perform(params: { sinceDate?: string }) {
    let lastUpdated = params.sinceDate ? new Date(`${params.sinceDate}T00:00:00+09:00`) : null;
    if (!lastUpdated) {
      const [latest] = await this.bq.query<{ updated_at: Date }>(
        'SELECT updated_at FROM `logiless.sales_orders` ORDER BY updated_at DESC LIMIT 1',
      );
      lastUpdated = latest?.updated_at ?? new Date('2024-04-01T00:00:00+09:00');
    }
    if (!lastUpdated) throw new Error('No last updated date');

    let hasNext = true;
    let page = 1;
    while (hasNext) {
      const res = await this.logiless.getSalesOrders(lastUpdated, page);
      const newSalesOrders = res.data.map((item) => ({
        id: item.id,
        code: item.code,
        document_status: item.document_status,
        allocation_status: item.allocation_status,
        delivery_status: item.delivery_status,
        incoming_payment_status: item.incoming_payment_status,
        authorization_status: item.authorization_status,
        customer_code: item.customer_code,
        payment_method: item.payment_method,
        delivery_method: item.delivery_method,
        buyer_country: item.buyer_country,
        recipient_country: item.recipient_country,
        store_id: item.store.id,
        store_name: item.store.name,
        document_date: item.document_date,
        ordered_at: new Date(`${item.ordered_at}+09:00`),
        finished_at: item.finished_at ? new Date(`${item.finished_at}+09:00`) : null,
        created_at: new Date(`${item.created_at}+09:00`),
        updated_at: new Date(`${item.updated_at}+09:00`),
      }));

      const salesOrderIds = newSalesOrders.map((r) => r.id);
      if (salesOrderIds.length) {
        console.log('sales_orders:deleting', salesOrderIds);
        await this.bq.query(SqlString.format('DELETE FROM `logiless.sales_orders` WHERE id IN (?)', [salesOrderIds]));

        console.log('sales_orders:inserting', newSalesOrders.length, 'records');
        await this.bq.query(
          SqlString.format('INSERT INTO `logiless.sales_orders` (??) VALUES ?', [
            Object.keys(newSalesOrders[0]),
            newSalesOrders.map((r) => Object.values(r)),
          ]),
        );
      }

      const newSalesOrderLines = res.data.flatMap((item) =>
        item.lines.map((line) => ({
          id: line.id,
          sales_order_id: item.id,
          status: line.status,
          article_code: line.article_code,
          article_name: line.article_name,
          quantity: line.quantity,
        })),
      );

      if (newSalesOrderLines.length) {
        console.log('sales_order_lines:deleting', salesOrderIds);
        await this.bq.query(SqlString.format('DELETE FROM `logiless.sales_order_lines` WHERE sales_order_id IN (?)', [salesOrderIds]));

        console.log('sales_order_lines:inserting', newSalesOrderLines.length, 'records');
        await this.bq.query(
          SqlString.format('INSERT INTO `logiless.sales_order_lines` (??) VALUES ?', [
            Object.keys(newSalesOrderLines[0]),
            newSalesOrderLines.map((r) => Object.values(r)),
          ]),
        );
      }

      hasNext = res.hasNext;
      page++;
    }
  }
}

type DocumentStatus = 'Processing' | 'WaitingForPayment' | 'WaitingForAllocation' | 'WaitingForShipment' | 'Shipped' | 'Cancel';
type AllocationStatus = 'WaitingForAllocation' | 'Allocated';
type DeliveryStatus = 'WaitingForShipment' | 'Working' | 'PartlyShipped' | 'Shipped' | 'Pending' | 'Cancel';
type IncomingPaymentStatus = 'NotPaid' | 'PartlyPaid' | 'Paid';
type AuthorizationStatus = 'NotRequired' | 'Unauthorized' | 'Authorizing' | 'Authorized' | 'Captured' | 'AuthorizationFailure';
type LineStatus = 'WaitingForTransfer' | 'WaitingForAllocation' | 'Allocated' | 'Shipped' | 'Cancel';

type SalesOrderLine = {
  id: number;
  status: LineStatus;
  article_code: string;
  article_name: string;
  quantity: number;
};

type SalesOrder = {
  id: number;
  code: string;
  document_status: DocumentStatus;
  allocation_status: AllocationStatus;
  delivery_status: DeliveryStatus;
  incoming_payment_status: IncomingPaymentStatus;
  authorization_status: AuthorizationStatus;
  customer_code?: string;
  payment_method: string;
  delivery_method: string;
  buyer_country: string;
  recipient_country: string;
  store: {
    id: number;
    name: string;
  };
  document_date: string;
  ordered_at: string;
  finished_at?: string;
  created_at: string;
  updated_at: string;
  lines: SalesOrderLine[];
};

type GetSalesOrdersResponse = {
  data: SalesOrder[];
  current_page: number;
  limit: number;
  total_count: number;
  hasNext: boolean;
};

class LogilessAPIClient {
  constructor(
    readonly kv: KVNamespace,
    readonly clientId: string,
    readonly clientSecret: string,
  ) {}

  private async getAccessToken() {
    const token = await this.kv.getWithMetadata<{ access_token: string; refresh_token: string }, { expire: Date }>(
      'LOGILESS_TOKEN',
      'json',
    );
    if (!token.value) throw new Error('Not logged in');
    if (!token.metadata || token.metadata.expire < new Date()) {
      const res = await fetch(
        `https://app2.logiless.com/oauth2/token?client_id=${this.clientId}&client_secret=${this.clientSecret}&refresh_token=${token.value.refresh_token}&grant_type=refresh_token`,
      );
      if (!res.ok) throw new Error('Failed to refresh token');
      const newToken = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
        scope: string;
      };
      await this.kv.put('LOGILESS_TOKEN', JSON.stringify({ access_token: newToken.access_token, refresh_token: newToken.refresh_token }), {
        metadata: { expire: new Date(Date.now() + newToken.expires_in * 1000) },
      });
      return newToken.access_token;
    }
    return token.value.access_token;
  }

  async getSalesOrders(since: Date, page = 1): Promise<GetSalesOrdersResponse> {
    console.log('getSalesOrders', since, page);
    const url = new URL('https://app2.logiless.com/api/v1/merchant/1394/sales_orders');
    url.searchParams.set('updated_at_from', dateForQuery(since));
    url.searchParams.set('updated_at_to', dateForQuery(new Date(since.getTime() + 24 * 60 * 60 * 1000)));
    url.searchParams.set('limit', '50');
    url.searchParams.set('page', page.toString());
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
      },
    });

    if (!res.ok) throw new Error('Failed to get sales orders');

    const data = (await res.json()) as Exclude<GetSalesOrdersResponse, 'next'>;
    console.log('getSalesOrders', data.total_count, data.current_page, data.limit);

    const hasNext = data.total_count > data.current_page * data.limit;

    return {
      ...data,
      hasNext,
    };
  }
}

const dateForQuery = (date: Date) => {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');
};

export const logilessTokenManager = async (req: Request, env: Env) => {
  if (req.url.includes('/logiless/login')) {
    return new Response('', {
      status: 302,
      headers: {
        Location: `https://app2.logiless.com/oauth/v2/auth?client_id=${env.LOGILESS_CLIENT_ID}&response_type=code&redirect_uri=${env.LOGILESS_REDIRECT_URI}`,
      },
    });
  }
  if (req.url.includes('/logiless/callback')) {
    const code = new URL(req.url).searchParams.get('code');
    if (!code) return new Response('Missing code', { status: 400 });

    const res = await fetch(
      `https://app2.logiless.com/oauth2/token?client_id=${env.LOGILESS_CLIENT_ID}&client_secret=${env.LOGILESS_CLIENT_SECRET}&code=${code}&grant_type=authorization_code&redirect_uri=${env.LOGILESS_REDIRECT_URI}`,
    );
    if (!res.ok) return new Response('Failed to get token', { status: res.status });
    const { access_token, refresh_token, expires_in } = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      scope: string;
    };
    await env.KV.put('LOGILESS_TOKEN', JSON.stringify({ access_token, refresh_token }), {
      metadata: { expire: new Date(Date.now() + expires_in * 1000) },
    });

    return new Response('Logged in', { status: 200 });
  }
};
