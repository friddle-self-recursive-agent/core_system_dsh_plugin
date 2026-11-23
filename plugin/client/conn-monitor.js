// 连接态灯判定核（console-adoption.md §1.5 三色设计，E1 落实现）。
// DOM 无关、时钟与 fetch 可注入（node --test 确定性断言）：
//   - 流面：对 dsh web 客户端通道 /plugins/events（client-hmr bundle graph 通道）做自持
//     fetch 流式读——用 ReadableStream 而非 EventSource：门注入的心跳是 SSE 注释帧，
//     浏览器 EventSource 吞注释帧（零回调），流式读才能把注释帧当活性证据（§1.5「心跳帧参与活性判定」）。
//   - rotated 判定边界=登录面（index）：对页面自身地址（含 token 的查询串）重取，
//     连续 3 次 401 即判定且不再重试（旧 token 重试必败）；2xx 清零；网络错误不计入。
//   - 退避：1s 起步 ×2 封顶 30s；优先级 rotated ＞ reconnecting ＞ connected。
//   - 不自存 token/key（R-PUB）；恢复=浏览器重走固定入口（部署侧固定钥匙门）。
function createConnMonitor(opts) {
  opts = opts || {}
  var fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null)
  if (!fetchImpl) throw new Error('conn-monitor: fetch unavailable')
  var eventsPath = opts.eventsPath || 'plugins/events' // 文档相对：与 dsh combo 同前缀解析
  var probePath = opts.probePath || '/'
  var freshMs = opts.freshMs || 40000 // 2×心跳周期（门 20s 注帧）
  var startMs = opts.backoffStart || 1000
  var capMs = opts.backoffCap || 30000
  var strikeMax = opts.rotatedStrikes || 3
  var probeEveryMs = opts.probeEveryMs === undefined ? 60000 : opts.probeEveryMs // 连接稳态下的登录面复检节奏（rotated 面覆盖）
  var onChange = opts.onChange || function () {}
  var now = opts.now || function () { return Date.now() }

  var state = 'reconnecting'
  var attempts = 0
  var strikes = 0
  var lastFrameAt = 0
  var stopped = true
  var timers = [] // 全部待决定时器（watchdog 与退避共存，stop 一律清空）
  var abort = null

  function snapshot() { return { state: state, attempts: attempts, strikes: strikes, lastFrameAt: lastFrameAt } }
  function fire() { try { onChange(snapshot()) } catch (e) { /* 通知方异常不反噬判定核 */ } }
  function setState(s) {
    if (state !== s) {
      state = s
      if (s === 'rotated') {
        // rotated=页内终态（§1.5：不再重试，恢复=重走固定入口=页面重载）——停流停钟，防
        // 无鉴权流面（/plugins/events）把终态拉回 connected 抹掉 strikes（E1 实测缺陷）。
        if (abort) { try { abort.abort() } catch (e) {} }
        timers.forEach(function (t) { clearTimeout(t) })
        timers = []
      }
      fire()
    }
  }

  function schedule(ms, fn) {
    var t = setTimeout(function () {
      var i = timers.indexOf(t)
      if (i >= 0) timers.splice(i, 1)
      fn()
    }, ms)
    timers.push(t)
    return t
  }

  // 登录面重取：401→计入 strikes；2xx→清零；传输失败/其他码→不计（§1.5：401 判据只在登录面授权门）
  function probeIndex() {
    return fetchImpl(probePath, { credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
      if (res.status === 401) { strikes++; return 'auth-fail' }
      if (res.status >= 200 && res.status < 400) { strikes = 0; return 'ok' }
      return 'other'
    }, function () { return 'transport' })
  }

  // 流式读通道：任意字节（数据帧或注释帧）都是活性证据
  function pump() {
    abort = new AbortController()
    return fetchImpl(eventsPath, {
      headers: { accept: 'text/event-stream' }, cache: 'no-store',
      credentials: 'same-origin', signal: abort.signal,
    }).then(function (res) {
      if (!res.ok || !res.body) throw new Error('stream http ' + res.status)
      var reader = res.body.getReader()
      lastFrameAt = now()
      setState('connected')
      function step() {
        if (stopped) return Promise.resolve()
        return reader.read().then(function (r) {
          if (r.done) throw new Error('stream closed')
          if (r.value && r.value.length) lastFrameAt = now()
          if (state === 'reconnecting') { attempts = 0; strikes = 0; setState('connected') } // 仅从重连态恢复；rotated=终态不被流面回写
          return step()
        })
      }
      return step()
    })
  }

  function attemptLoop() {
    if (stopped || state === 'rotated') return
    attempts++
    setState('reconnecting')
    fire() // attempts 变化驱动「重连中（第 N 次）」细条
    probeIndex().then(function (verdict) {
      if (stopped || state === 'rotated') return
      if (verdict === 'auth-fail' && strikes >= strikeMax) { setState('rotated'); return } // 不再重试
      var delay = Math.min(startMs * Math.pow(2, attempts - 1), capMs)
      schedule(delay, function () {
        if (stopped || state === 'rotated') return
        pump().catch(function () {
          if (stopped || state === 'rotated') return
          attemptLoop()
        })
      })
    })
  }

  // 活性看门狗：connected 但帧不新鲜（流静默死亡）→ 掐断重连
  function watchdog() {
    if (stopped) return
    if (state === 'connected' && lastFrameAt && now() - lastFrameAt > freshMs) {
      if (abort) { try { abort.abort() } catch (e) {} }
      attemptLoop()
    }
  }

  // 登录面周期复检（connected 稳态）：鉴权失效（如会话被吊销）→ 连续 401 计满即 rotated。
  // 实测注（E1）：dsh 0.2.2-rc.5 的 cookie 会话跨进程签名有效——launch token 轮换只影响
  // 新进入（门消化），不推翻既有会话；本复检在真鉴权失效时兜底触发 rotated（§1.5 三色完备）。
  function steadyProbe() {
    if (stopped || state !== 'connected') return
    probeIndex().then(function (verdict) {
      if (stopped || state !== 'connected') return
      if (verdict === 'auth-fail' && strikes >= strikeMax) setState('rotated')
    })
  }

  return {
    start: function () {
      if (!stopped) return
      stopped = false
      setState('reconnecting')
      pump().catch(function () { attemptLoop() })
      if (opts.watchdog === false) return
      ;(function loop() {
        if (stopped) return
        schedule(opts.watchdogPeriod || 1000, function () { if (!stopped) { watchdog(); loop() } })
      })()
      if (probeEveryMs > 0) {
        ;(function ploop() {
          if (stopped) return
          schedule(probeEveryMs, function () { if (!stopped) { steadyProbe(); ploop() } })
        })()
      }
    },
    stop: function () {
      stopped = true
      timers.forEach(function (t) { clearTimeout(t) })
      timers = []
      if (abort) { try { abort.abort() } catch (e) {} }
    },
    state: snapshot,
    tick: watchdog, // 测试注入口：真实部署由 start 内定时器驱动
  }
}

// 闭包导出（bundle 内可见；console-app.js 经 __CC 取用）。独立求值（单测）时无 __CC，跳过。
if (typeof __CC !== 'undefined') __CC.createConnMonitor = createConnMonitor
