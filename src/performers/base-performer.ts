import { KiribiPerformer } from 'kiribi/performer';
import { BigQuery } from 'cfw-bq';
import { Env } from '../../worker-configuration';

export abstract class BasePerformer extends KiribiPerformer {
  bq: BigQuery;
  kv: KVNamespace;

  protected constructor(ctx: ExecutionContext, env: Env) {
    super(ctx, env);
    this.bq = new BigQuery(JSON.parse(env.GCP_SERVICE_ACCOUNT), 'shopify-322306');
    this.kv = env.KV;
  }

  abstract perform(params: any): any;
}
