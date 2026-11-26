// 桥端到端测试：拉起真实 cored（PATH/env 定位，同桥契约的二进制定位机制）+
// fixture scheme/文档库（os.tmpdir，零部署锚点）→ 经持续查询句柄机械断言读面。
// cored 不在 PATH 时 skip（宿主健康优先于桥接成功，契约 §3 同款语义）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseReadyLine, createQueryHandle } from '../src/index.ts'

const SCHEME = `apiVersion: core/v1
kind: Scheme
metadata: {name: default, scope: builtin}
spec:
  version: core/v1
  kinds:
    - {kind: Scheme, builtin: true, storage: core/scheme.yaml}
    - {kind: Agent, builtin: true, storage: global/agents/<name>/agent.yaml}
  eventTypes:
    - {type: DocApplied, source: core, defaultLevel: info, route: owner-workflow}
`

const AGENT_DOC = `apiVersion: core/v1
kind: Agent
metadata: {name: fixture-agent, scope: global, resourceVersion: 1}
spec: {autoLevel: ask}
`

function locateCored(): string | null {
  const cand = process.env.CORE_SYSTEM_TEST_CORED || process.env.CORE_SYSTEM_CORED_BIN || 'cored'
  const probe = spawnSync(cand, ['-h'], { timeout: 5000 })
  if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') return null
  return cand
}

function makeFixture(): { root: string; scheme: string; docs: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'cored-e2e-'))
  const scheme = path.join(root, 'scheme.yaml')
  writeFileSync(scheme, SCHEME)
  const docs = path.join(root, 'docs') // cored --docs 锚=git 后端文档库根（存储层=git 仓本身）
  mkdirSync(path.join(docs, 'global', 'agents', 'fixture-agent'), { recursive: true })
  writeFileSync(path.join(docs, 'global', 'agents', 'fixture-agent', 'agent.yaml'), AGENT_DOC)
  const git = (args: string) => spawnSync('git', args, { cwd: docs, encoding: 'utf8' })
  git(['init', '-q'])
  git(['add', '-A'])
  git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'seed'])
  return { root, scheme, docs }
}

test('真实 cored 端到端：就绪行→句柄 list/get/404→写面关断 405', async (t) => {
  const bin = locateCored()
  if (!bin) return t.skip('cored 不在 PATH 且未设 CORE_SYSTEM_TEST_CORED')
  const fx = makeFixture()
  const child = spawn(bin, ['--scheme', fx.scheme, '--docs', fx.docs, '--docs-backend', 'git'], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    // 就绪：读 stdout 就绪行（复用真解析器），5s 超时判 fail
    const ready = await new Promise<ReturnType<typeof parseReadyLine>>((resolve, reject) => {
      let buf = ''
      const timer = setTimeout(() => reject(new Error('cored 5s 未就绪')), 5000)
      child.stdout!.on('data', (c: Buffer) => {
        buf += c.toString()
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        let hit: ReturnType<typeof parseReadyLine> = null
        for (const line of lines) {
          const p = parseReadyLine(line)
          if (p && !hit) hit = p
        }
        if (hit) { clearTimeout(timer); resolve(hit) }
      })
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`cored 提前退出 code=${code}`)) })
    })
    assert.ok(ready, '就绪行可解析')
    const url = `http://${ready!.addr}`

    const h = createQueryHandle(url)
    const lst = await h.list('Agent')
    assert.equal(lst.ok, true)
    if (lst.ok) {
      assert.equal(lst.data.length, 1)
      assert.deepEqual({ name: lst.data[0].name, scope: lst.data[0].scope, rv: lst.data[0].resourceVersion },
        { name: 'fixture-agent', scope: 'global', rv: 1 })
    }
    const one = await h.get('Agent', 'global', 'fixture-agent')
    assert.equal(one.ok, true)
    if (one.ok) assert.match(one.data.content, /autoLevel: ask/)
    const miss = await h.get('Agent', 'global', 'absent')
    assert.ok(!miss.ok && miss.status === 404)
    const ghostKind = await h.list('Ghost')
    assert.ok(!ghostKind.ok && ghostKind.status === 404)

    // 写面关断回归：句柄只读；cored 缺省不开启 POST /v1/apply → 405
    const post = await fetch(`${url}/v1/apply`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'Agent', scope: 'global', name: 'fixture-agent', content: AGENT_DOC, fieldManager: 'e2e-test' }) })
    assert.equal(post.status, 405)
  } finally {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 200))
    rmSync(fx.root, { recursive: true, force: true })
  }
})
