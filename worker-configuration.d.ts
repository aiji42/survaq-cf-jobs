import { Kiribi } from 'kiribi';
import { Logiless } from './src';

export interface Env {
  GCP_SERVICE_ACCOUNT: string;
  KIRIBI_DB: D1Database;
  KIRIBI: Service<
    Kiribi<{
      LOGILESS: Logiless;
    }>
  >;
  KIRIBI_QUEUE: Queue;
  LOGILESS_CLIENT_ID: string;
  LOGILESS_CLIENT_SECRET: string;
  LOGILESS_REDIRECT_URI: string;
  KV: KVNamespace;
}
