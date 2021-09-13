import { Context, pick, Dict, version as currentVersion, Schema } from 'koishi'
import { dirname, resolve } from 'path'
import { existsSync, promises as fs } from 'fs'
import { spawn, StdioOptions } from 'child_process'
import { satisfies } from 'semver'
import axios from 'axios'

interface PackageBase {
  name: string
  version: string
  description: string
}

interface PackageJson extends PackageBase {
  dependencies?: Dict<string>
  devDependencies?: Dict<string>
  peerDependencies?: Dict<string>
  optionalDependencies?: Dict<string>
}

interface PackageLocal extends PackageJson {
  private?: boolean
}

interface PackageRemote extends PackageJson {
  dist: {
    unpackedSize: number
  }
}

interface SearchResult {
  results: any[]
}

interface Registry extends PackageBase {
  versions: Dict<PackageRemote>
}

type Manager = 'yarn' | 'npm'

const cwd = process.cwd()

function execute(bin: string, args: string[] = [], stdio: StdioOptions = 'inherit') {
  // fix for #205
  // https://stackoverflow.com/questions/43230346/error-spawn-npm-enoent
  const child = spawn(bin + (process.platform === 'win32' ? '.cmd' : ''), args, { stdio })
  return new Promise<number>((resolve) => {
    child.on('close', resolve)
  })
}

let _managerPromise: Promise<Manager>
async function getManager(): Promise<Manager> {
  if (existsSync(resolve(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(resolve(cwd, 'package-lock.json'))) return 'npm'
  if (!await execute('yarn', ['--version'], 'ignore')) return 'yarn'
  return 'npm'
}

const installArgs: Record<Manager, string[]> = {
  yarn: ['add'],
  npm: ['install', '--loglevel', 'error'],
}

class Market {
  cached: Promise<Market.Data[]>

  constructor(private ctx: Context, public config: Market.Config) {
    ctx.router.get(config.apiPath + '/package(/.+)+', async (ctx) => {
      const name = ctx.path.slice(config.apiPath.length + 9)
      const { data } = await axios.get(`https://registry.npmjs.org/${name}`)
      ctx.body = data
      ctx.set('Access-Control-Allow-Origin', '*')
    })
  }

  async get(forced = false) {
    if (this.cached && !forced) return this.cached
    return this.cached = this.getForced()
  }

  private async getForced() {
    const loadDep = async (filename: string, uuid?: string) => {
      do {
        filename = dirname(filename)
        const files = await fs.readdir(filename)
        if (files.includes('package.json')) break
      } while (true)
      const data: PackageLocal = JSON.parse(await fs.readFile(filename + '/package.json', 'utf8'))
      if (data.private) return null
      const workspace = !filename.includes('node_modules')
      const { schema } = require(filename)
      return { schema, workspace, uuid, ...pick(data, ['name', 'version', 'description']) }
    }

    const loadCache: Dict<Promise<Market.Local>> = {}

    const [{ data }] = await Promise.all([
      axios.get<SearchResult>('https://api.npms.io/v2/search?q=koishi+plugin+not:deprecated&size=250'),
      Promise.all(Object.keys(require.cache).map(async (filename) => {
        const { exports } = require.cache[filename]
        const state = this.ctx.app.registry.get(exports)
        if (!state) return
        return loadCache[filename] ||= loadDep(filename, state.id)
      })),
    ])

    const loadLocal = (name: string) => {
      try {
        const filename = require.resolve(name)
        return loadCache[filename] ||= loadDep(filename)
      } catch {}
    }

    return Promise.all(data.results.map(async (item) => {
      const { name, version } = item.package
      const official = name.startsWith('@koishijs/plugin-')
      const community = name.startsWith('koishi-plugin-')
      if (!official && !community) return

      const [local, { data }] = await Promise.all([
        loadLocal(name),
        axios.get<Registry>(`https://registry.npmjs.org/${name}`),
      ])
      const { dependencies = {}, peerDependencies = {}, dist } = data.versions[version]
      const declaredVersion = { ...dependencies, ...peerDependencies }['koishi']
      if (!declaredVersion || !satisfies(currentVersion, declaredVersion)) return

      const shortname = official ? name.slice(17) : name.slice(14)
      return {
        ...item.package,
        shortname,
        local,
        official,
        size: dist.unpackedSize,
        score: {
          final: item.score.final,
          ...item.score.detail,
        },
      } as Market.Data
    })).then(data => data.filter(Boolean))
  }

  async install(name: string) {
    const kind = await (_managerPromise ||= getManager())
    const args = [...installArgs[kind], name]
    await execute(kind, args)
    this.ctx.webui.broadcast('market', await this.get(true))
  }
}

namespace Market {
  export interface Config {
    apiPath?: string
  }

  export interface Local extends PackageBase {
    workspace: boolean
    schema?: Schema
    uuid?: string
  }

  export interface Data extends PackageBase {
    shortname: string
    local?: Local
    official: boolean
    size: number
    score: {
      final: number
      quality: number
      popularity: number
      maintenance: number
    }
  }
}

export default Market
