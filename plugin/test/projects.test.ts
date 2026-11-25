// 能力 C：Service → dsh Workspace 最小映射（不迁移旧会话、不复制持久状态）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(HERE, '../client/console-projects.js'), 'utf8')

function load(existing = []) {
  const calls: Array<{ path: string; opts: any }> = []
  const creates: any[] = []
  const cc: any = {
    hostFaces: {
      workspaces: {
        list: { getSnapshot: () => ({ items: existing }) },
        create: async (input: any) => {
          creates.push(input)
          return { workspaceId: 'ws-' + creates.length, title: input.path.split('/').pop(), path: input.path, sessionIds: [] }
        },
      },
    },
    agentOwnerOf: (agent: string) => agent === 'core-headless' ? { system: 'self-recursive-core', instance: 'default' } : null,
  }
  const fetchImpl = async (path: string, opts: any = {}) => {
    calls.push({ path, opts })
    const body = path.endsWith('/service-projects') && (opts.method || 'GET') === 'GET'
      ? { count: 1, services: [{ name: 'self-recursive-core', scope: 'systems/self-recursive-core', agents: ['core-headless'] }] }
      : { count: 1, projects: [{ service: 'self-recursive-core', path: '/tmp/service-projects/self-recursive-core' }] }
    return { ok: true, status: 200, json: async () => body }
  }
  new Function('__CC', 'fetch', SRC)(cc, fetchImpl)
  return { cc, calls, creates }
}

test('Service project：GET/POST 同源投影 → ctx.workspaces.create → projectForAgent 命中', async () => {
  const { cc, calls, creates } = load()
  const state = await cc.serviceProjects.ensure()
  assert.equal(state.ready, true)
  assert.equal(calls[0].path, '/core-console/service-projects')
  assert.equal(calls[1].opts.method, 'POST')
  assert.equal(creates.length, 1)
  assert.equal(cc.serviceProjects.projectForAgent('core-headless').service, 'self-recursive-core')
  assert.equal(cc.serviceProjects.projectForAgent('legacy-agent'), null, '旧 Agent 不强行归组')
  assert.equal(await cc.serviceProjects.ensure(), state, '已就绪幂等，不重复创建')
})

test('Service project：同名 Workspace 已存在则幂等复用；零旧会话迁移/归档调用', async () => {
  const { cc, creates } = load([{ workspaceId: 'ws-existing', title: 'self-recursive-core', path: '/tmp/service-projects/self-recursive-core', sessionIds: ['legacy-session'] }])
  const state = await cc.serviceProjects.ensure()
  assert.equal(state.ready, true)
  assert.equal(creates.length, 0)
  assert.equal(state.projects['self-recursive-core'].workspaceId, 'ws-existing')
  assert.deepEqual(cc.hostFaces.workspaces.list.getSnapshot().items[0].sessionIds, ['legacy-session'])
})
