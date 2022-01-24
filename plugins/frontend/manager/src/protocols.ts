import { Adapter, Context, Dict, Schema } from 'koishi'
import { DataService } from '@koishijs/plugin-console'

export default class AdapterProvider extends DataService<Dict<Schema>> {
  constructor(ctx: Context) {
    super(ctx, 'protocols')

    ctx.on('adapter', () => {
      this.refresh()
    })
  }

  async get() {
    const protocols: Dict<Schema> = {}
    for (const key in Adapter.library) {
      if (key.includes('.')) continue
      protocols[key] = Adapter.library[key].schema
    }
    return protocols
  }

  start() {}

  stop() {}
}