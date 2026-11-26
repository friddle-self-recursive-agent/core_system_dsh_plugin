// bridges/chatfaces.ts —— 控制台对话通路（2026-11-26 用户裁决：入口永远一个对话框可选
// session；目标是找文档/更新文档）。实现面：
//   POST /core-console/chat-send {sessionId, text} → sessionController.prompt(queue 模式)
//   GET  /core-console/chatfaces.js → 页面端引导（window.__CC.chatFaces.send 落此通路）
// 红线：prompt 是 selfheal 桥同款受信通路（宿主判定面不重复校验 subject——栅栏与 cookie
// 门牌已是前置闸）；send 受理=queue 落投，回执 requestId 供对话线程锚定；宿主缺席=503
// 显式缺席（绝不冒充送达）。
import { sendJson, readRequestBody, type HttpReqLike, type HttpResLike } from '../http.ts'

export interface ChatFacesDeps {
  prompt: ((req: { sessionId: string; requestId: string; mode: 'queue' | 'steer'; content: { type: 'text'; text: string }[] }) => Promise<unknown>) | null
}

const CLIENT_JS = `/* chatfaces.js —— 控制台对话通路页面端（window.__CC.chatFaces → 自有对话面数据面）。
 * send=queue 落投；sessions/transcript/state/create=宿主转录桥四读写面。 */
(function () {
  var f = (window.__CC = window.__CC || {}).chatFaces = (window.__CC.chatFaces || {});
  function call(path, opts) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}))
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, data: j }; }); });
  }
  f.send = function (sessionId, text) {
    return call('/core-console/chat-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: String(sessionId || ''), text: String(text || '') }),
    });
  };
  f.sessions = function () { return call('/core-console/chat-sessions'); };
  f.transcript = function (sessionId, max, beforeSeq) {
    var q = '?sessionId=' + encodeURIComponent(String(sessionId || ''));
    if (max) q += '&max=' + Number(max);
    if (beforeSeq) q += '&beforeSeq=' + Number(beforeSeq);
    return call('/core-console/chat-transcript' + q);
  };
  f.state = function (sessionId) {
    return call('/core-console/chat-state?sessionId=' + encodeURIComponent(String(sessionId || '')));
  };
  f.create = function () {
    return call('/core-console/chat-create', { method: 'POST' });
  };
  f.available = true;
})();
`

/** 页面端引导脚本（无状态常量——no-store 防陈旧）。 */
export function createChatFacesClientHandler(opts: {
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
}) {
  return function chatFacesClientHandler(req: HttpReqLike, res: HttpResLike): void {
    if (!opts.reject) { res.statusCode = 401; res.end(); return }
    const rejection = opts.reject({ headers: req.headers })
    if (rejection !== undefined) { res.statusCode = rejection; res.end(); return }
    res.statusCode = 200
    res.setHeader('content-type', 'application/javascript; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(CLIENT_JS)
  }
}

/** 发送通路：sessionController.prompt(queue)——受理回执 requestId；缺席/失败=显式错误词形。 */
export function createChatSendHandler(opts: {
  deps: ChatFacesDeps
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
}) {
  return async function chatSendHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
    if (!opts.reject) { res.statusCode = 401; res.end(); return }
    const rejection = opts.reject({ headers: req.headers })
    if (rejection !== undefined) { res.statusCode = rejection; res.end(); return }
    if ((req.method ?? 'POST') !== 'POST') {
      res.statusCode = 405
      res.setHeader('allow', 'POST')
      res.end()
      return
    }
    if (!opts.deps.prompt) {
      sendJson(res, 503, { error: '宿主 prompt 面未就绪（sessionController 缺席——绝不冒充送达）' })
      return
    }
    let body: { sessionId?: unknown; text?: unknown }
    try {
      body = JSON.parse((await readRequestBody(req)) || '{}')
    } catch {
      sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
      return
    }
    const sessionId = String(body.sessionId || '').trim()
    const text = String(body.text || '').trim()
    if (!sessionId || !text) {
      sendJson(res, 400, { error: 'sessionId 与 text 均必填' })
      return
    }
    if (sessionId.length > 200 || text.length > 20000) {
      sendJson(res, 413, { error: '载荷超限（sessionId≤200 text≤20000）' })
      return
    }
    const requestId = 'cc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    try {
      await opts.deps.prompt({
        sessionId,
        requestId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      })
      sendJson(res, 200, { ok: true, sessionId, requestId, mode: 'queue' })
    } catch (e) {
      sendJson(res, 502, { error: 'prompt 落投失败: ' + String((e as Error)?.message ?? e) })
    }
  }
}
