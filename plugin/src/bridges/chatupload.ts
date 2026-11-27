// bridges/chatupload.ts —— 控制台聊天图片上传（2026-11-27 用户裁决：发图走「上传 + markdown 引用」）。
// 协议：POST /core-console/chat-upload  JSON {image: <base64 data url 或裸 base64>, mime?, name?}
//       → {ok:true, url:'/core-console/uploads/<file>', mime, size}
// 图片落 os.tmpdir()/self-recursive-agent-chat-uploads/<YYYYMMDD>/<uuid>.<ext>，
// 由 GET /core-console/uploads/<file> 静态 serve；不落 web/dist（产物白名单只放行 console.js/css）。
// 鉴权沿用宿主 reject 门；MIME 白名单 + 体积上限（8MB）双护栏；prompt 契约不变（agent 收到 markdown 文本引用）。
import { sendJson, type HttpReqLike, type HttpResLike } from '../http.ts'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'

const UPLOAD_ROOT = join(tmpdir(), 'self-recursive-agent-chat-uploads')
const MAX_BYTES = 8 << 20 // 8MB 解码后
const MIME_EXT: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/svg+xml': '.svg',
}
export const CONSOLE_CHAT_UPLOAD_PATH = '/core-console/chat-upload'
export const CONSOLE_CHAT_UPLOAD_ASSETS = '/core-console/uploads'

function dayDir(): string {
  const d = new Date()
  const stamp = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
  const dir = join(UPLOAD_ROOT, stamp)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** 读 JSON body（自定义 cap，不走 http.ts 的 4MB 字符串 cap）。 */
async function readJson(req: HttpReqLike, cap: number): Promise<any> {
  if (typeof req.body === 'string') return JSON.parse(req.body)
  if (typeof req.on !== 'function') return {}
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (err?: unknown) => {
      if (done) return
      done = true
      try { req.off?.('data', onData); req.off?.('end', onEnd); req.off?.('error', onErr) } catch { /* 假体可无 off */ }
      if (err) { reject(err); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch (e) { reject(e) }
    }
    const onData = (chunk?: Buffer | string) => {
      const b = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk ?? Buffer.alloc(0))
      size += b.length
      if (size > cap) { finish(new Error('载荷超限')); return }
      chunks.push(b)
    }
    const onEnd = () => finish()
    const onErr = (e: unknown) => finish(e)
    req.on('data', onData); req.on('end', onEnd); req.on('error', onErr)
  })
}

export function createChatUploadHandler(opts: {
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
}) {
  return async function chatUploadHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
    if (opts.reject) {
      const denial = opts.reject({ headers: req.headers })
      if (denial !== undefined) { res.statusCode = denial; res.end(); return }
    }
    if ((req.method ?? 'POST') !== 'POST') { res.statusCode = 405; res.setHeader('allow', 'POST'); res.end(); return }
    let body: any
    try { body = await readJson(req, MAX_BYTES + (1 << 20)) }
    catch { sendJson(res, 400, { error: '上传载荷解析失败或超限（≤8MB 图片）' }); return }
    const raw = String(body.image || '')
    if (!raw) { sendJson(res, 400, { error: 'image 必填（base64 data url 或裸 base64）' }); return }
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(raw)
    const mime = String(body.mime || (m ? m[1] : '') || '').toLowerCase()
    const b64 = m ? m[2] : raw
    const ext = MIME_EXT[mime]
    if (!ext) { sendJson(res, 415, { error: '仅支持 png/jpeg/gif/webp/svg' }); return }
    let buf: Buffer
    try { buf = Buffer.from(b64, 'base64') } catch { sendJson(res, 400, { error: 'base64 解码失败' }); return }
    if (!buf.length) { sendJson(res, 400, { error: '图片为空' }); return }
    if (buf.length > MAX_BYTES) { sendJson(res, 413, { error: '图片超过 8MB 上限' }); return }
    const name = randomUUID().replace(/-/g, '') + ext
    try { writeFileSync(join(dayDir(), name), buf) }
    catch (e) { sendJson(res, 500, { error: '图片落盘失败: ' + String((e as Error)?.message ?? e) }); return }
    sendJson(res, 200, { ok: true, url: '/core-console/uploads/' + name, mime, size: buf.length })
  }
}

/** 静态 serve：GET /core-console/uploads/<file> → 上传目录里的图片。文件名白名单（防目录穿越）。 */
export function createChatUploadAssetHandler(opts: {
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
}) {
  return function chatUploadAssetHandler(req: HttpReqLike, res: HttpResLike): void {
    if (opts.reject) {
      const denial = opts.reject({ headers: req.headers })
      if (denial !== undefined) { res.statusCode = denial; res.end(); return }
    }
    if ((req.method ?? 'GET') !== 'GET') { res.statusCode = 405; res.setHeader('allow', 'GET'); res.end(); return }
    const target = new URL(String(req.url ?? '/'), 'http://localhost')
    const name = basename(decodeURIComponent(target.pathname.slice(CONSOLE_CHAT_UPLOAD_ASSETS.length)))
    const ext = extname(name).toLowerCase()
    const mime = Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0]
    if (!mime || name.includes('..')) { sendJson(res, 404, { error: 'not found' }); return }
    // 遍历日期目录找文件（当天优先，回退根下所有子目录）
    const candidates = [join(dayDir(), name)]
    try {
      for (const d of readdirSync(UPLOAD_ROOT)) {
        const p = join(UPLOAD_ROOT, d, name)
        if (!candidates.includes(p)) candidates.push(p)
      }
    } catch { /* 根目录还没建 */ }
    for (const p of candidates) {
      if (!existsSync(p)) continue
      try {
        const body = readFileSync(p)
        res.statusCode = 200
        res.setHeader('content-type', mime)
        res.setHeader('cache-control', 'public, max-age=3600')
        res.end(body)
        return
      } catch { /* 下一个候选 */ }
    }
    sendJson(res, 404, { error: '图片不存在或已清理' })
  }
}
