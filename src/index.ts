import { Kiribi } from 'kiribi';
import { client } from 'kiribi/client';
import { rest } from 'kiribi/rest';
import { Env } from '../worker-configuration';
import { logilessTokenManager } from './performers/logiless';
export { Logiless } from './performers/logiless';

export default class extends Kiribi<any, Env> {
  client = client;
  rest = rest;

  async scheduled({ cron }: ScheduledController) {
    if (cron === '0 0 * * *') await this.sweep();

    if (cron === '*/5 * * * *') await this.recover();

    if (cron === '*/10 * * * *') await this.env.KIRIBI.enqueue('LOGILESS', {});
  }

  async fetch(req: Request): Promise<Response> {
    const res = await logilessTokenManager(req, this.env);

    return res ?? (await super.fetch(req));
  }
}
