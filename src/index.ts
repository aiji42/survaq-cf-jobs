import { Kiribi } from 'kiribi'
import { client } from 'kiribi/client'
import { rest } from 'kiribi/rest'

export default class extends Kiribi {
  client = client
  rest = rest

  async schedule({ cron }: ScheduledController) {
    if (cron === '0 0 * * *') await this.sweep()

    if (cron === '*/5 * * * *') await this.recover()
  }
}
