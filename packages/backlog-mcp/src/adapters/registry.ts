import type { FrameworkAdapter, AdapterContext } from './types'
import type { WorkItem, FrameworkInfo } from '../contract'

/** Detects which adapters are present under a root and aggregates their items. */
export class Registry {
  constructor(
    private readonly adapters: FrameworkAdapter[],
    private readonly ctx: AdapterContext
  ) {}

  async present(): Promise<FrameworkAdapter[]> {
    const flags = await Promise.all(this.adapters.map((a) => a.detect(this.ctx)))
    return this.adapters.filter((_, i) => flags[i])
  }

  async detectFrameworks(): Promise<FrameworkInfo[]> {
    const present = await this.present()
    return Promise.all(
      present.map(async (a) => ({
        framework: a.name,
        root: this.ctx.root,
        itemCount: (await a.listItems(this.ctx)).length
      }))
    )
  }

  async listItems(): Promise<WorkItem[]> {
    const present = await this.present()
    const lists = await Promise.all(present.map((a) => a.listItems(this.ctx)))
    return lists.flat()
  }

  adapterFor(id: string): FrameworkAdapter | undefined {
    return this.adapters.find((a) => id.startsWith(`${a.name}:`))
  }

  context(): AdapterContext {
    return this.ctx
  }
}
