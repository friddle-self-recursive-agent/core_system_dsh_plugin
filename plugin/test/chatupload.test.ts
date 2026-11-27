// chatupload.test.ts —— 聊天图片上传（2026-11-27：上传 + markdown 引用）。
// MIME 白名单、体积上限、落盘 + 静态 serve、鉴权门。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChatUploadHandler, createChatUploadAssetHandler } from '../src/bridges/chatupload.ts'
import type { HttpReqLike, HttpResLike } from '../src/http.ts'

function fakeRes() {
  const r: any = {
    statusCode: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0),
    setHeader(k: string, v: string) { this.headers[k] = v },
    end(b?: any) { this.body = b ? (Buffer.isBuffer(b) ? b : Buffer.from(String(b))) : Buffer.alloc(0) },
    json() { return JSON.parse(this.body.toString('utf8')) },
  }
  return r as HttpResLike & { json(): any }
}

// 1x1 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

function fakePostReq(body: unknown): HttpReqLike {
  return { method: 'POST', headers: {}, body: JSON.stringify(body) } as any
}

test('chat-upload：合法 PNG → 落盘 + 返回 uploads URL；serve 回读', async () => {
  const res = fakeRes()
  await createChatUploadHandler({})(
    fakePostReq({ image: 'data:image/png;base64,' + PNG_B64, mime: 'image/png' }), res)
  assert.equal(res.statusCode, 200)
  const j = (res as any).json()
  assert.ok(j.ok && j.url.startsWith('/core-console/uploads/') && j.url.endsWith('.png'), '返回图片 URL')
  assert.equal(j.size > 0, true)

  const serve = fakeRes()
  createChatUploadAssetHandler({})(
    { method: 'GET', headers: {}, url: j.url } as any, serve)
  assert.equal(serve.statusCode, 200)
  assert.equal((serve as any).headers['content-type'], 'image/png')
  assert.ok(serve.body.length > 0, 'serve 回读非空')
})

test('chat-upload：非图片 MIME 拒收（415）；空图拒收（400）', async () => {
  const r1 = fakeRes()
  await createChatUploadHandler({})(
    fakePostReq({ image: 'data:text/html;base64,' + PNG_B64, mime: 'text/html' }), r1)
  assert.equal(r1.statusCode, 415)

  const r2 = fakeRes()
  await createChatUploadHandler({})(fakePostReq({ image: '' }), r2)
  assert.equal(r2.statusCode, 400)
})

test('chat-upload：鉴权门缺席=401（fail-closed，与 chat-send 同纪律）', async () => {
  const reject = () => 401 as const
  const r = fakeRes()
  await createChatUploadHandler({ reject })(fakePostReq({ image: PNG_B64, mime: 'image/png' }), r)
  assert.equal(r.statusCode, 401)
})
