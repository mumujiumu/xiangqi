'use strict';
/*
 * 独立回归测试 — 人机对战"必崩"修复 (ai.worker.js + game.js computeAIMove)
 *
 * 设计目标（以怀疑眼光独立验证，不信任工程师自检）：
 *   A) computeAIMove 在 Worker【成功 / 抛错 / 超时 / 加载失败】四种情形下，
 *      都「恰好回调 onMove 一次」且「返回合法着法」，主线程兜底链路不断裂/不卡死/不丢回调。
 *   B) ai.worker.js 引擎正确性：多组棋局（初始/中局/残局/困难深度3）返回的
 *      move.from/move.to 是合法坐标、落子后仍是合法局面。
 *   C) 两份 game.js / 两份 ai.worker.js 字节一致；四个文件 node --check 语法通过。
 *
 * 说明：复现脚本 repro_pve.mjs 在 Node 下因无浏览器 Worker 只能走主线程兜底分支，
 *      并未真正验证 Web Worker 异步路径（即 Android 上的真实修复路径）。
 *      本测试用 mock Worker 对象真正驱动 computeAIMove 的异步 Worker 链路做独立验证。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const JS_GAME = path.join(ROOT, 'js', 'game.js');
const WWW_GAME = path.join(ROOT, 'www', 'js', 'game.js');
const JS_WORKER = path.join(ROOT, 'js', 'ai.worker.js');
const WWW_WORKER = path.join(ROOT, 'www', 'js', 'ai.worker.js');

// ---------------- 轻量测试骨架 ----------------
let passCount = 0, failCount = 0;
const failures = [];
function check(cond, name, detail) {
  if (cond) { passCount++; console.log('  [PASS] ' + name); }
  else { failCount++; failures.push(name + (detail ? (' :: ' + detail) : '')); console.log('  [FAIL] ' + name + (detail ? (' :: ' + detail) : '')); }
}
function section(t) { console.log('\n================ ' + t + ' ================'); }

// ---------------- 棋局构造（独立、与源码无关） ----------------
function initialBoard() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  const blackBack = ['chariot', 'horse', 'elephant', 'advisor', 'king', 'advisor', 'elephant', 'horse', 'chariot'];
  blackBack.forEach((t, c) => (b[0][c] = { type: t, side: 'black' }));
  b[2][1] = { type: 'cannon', side: 'black' }; b[2][7] = { type: 'cannon', side: 'black' };
  [0, 2, 4, 6, 8].forEach((c) => (b[3][c] = { type: 'pawn', side: 'black' }));
  const redBack = ['chariot', 'horse', 'elephant', 'advisor', 'king', 'advisor', 'elephant', 'horse', 'chariot'];
  redBack.forEach((t, c) => (b[9][c] = { type: t, side: 'red' }));
  b[7][1] = { type: 'cannon', side: 'red' }; b[7][7] = { type: 'cannon', side: 'red' };
  [0, 2, 4, 6, 8].forEach((c) => (b[6][c] = { type: 'pawn', side: 'red' }));
  return b;
}
function emptyBoard() { return Array.from({ length: 10 }, () => Array(9).fill(null)); }
function applyMove(b, m) { const p = b[m.fr][m.fc]; b[m.tr][m.tc] = p; b[m.fr][m.fc] = null; }

// ---------------- 着法合法性（Part A：实现无关、稳健） ----------------
function isLegalMove(board, side, move) {
  if (!move || !move.from || !move.to) return false;
  const fr = move.from.row, fc = move.from.col, tr = move.to.row, tc = move.to.col;
  if (typeof fr !== 'number' || typeof fc !== 'number' || typeof tr !== 'number' || typeof tc !== 'number') return false;
  if (fr < 0 || fr > 9 || fc < 0 || fc > 8 || tr < 0 || tr > 9 || tc < 0 || tc > 8) return false;
  const p = board[fr][fc];
  if (!p || p.side !== side) return false;          // 起点必须是己方棋子
  const t = board[tr][tc];
  if (t && t.side === side) return false;           // 不能吃自己
  return true;
}

// ---------------- 加载 ai.worker.js 引擎（供 mock 与 Part B 校验） ----------------
let WORKER_SELF = null;
let WORKER_INTF = null;
function makeSelfMock() {
  return {
    _onmsg: null, _posted: null,
    set onmessage(f) { this._onmsg = f; },
    get onmessage() { return this._onmsg; },
    postMessage(m) { this._posted = m; }
  };
}
function loadWorkerEngine() {
  const code = fs.readFileSync(JS_WORKER, 'utf-8');
  WORKER_SELF = makeSelfMock();
  try { delete global.self; } catch (_) {}
  global.self = WORKER_SELF;
  const snippet = '\n;self.__internals = { findBestMove: findBestMove, getAllLegalMoves: getAllLegalMoves, getLegalMoves: getLegalMoves, inBoard: inBoard };';
  new Function(code + snippet)();
  WORKER_INTF = WORKER_SELF.__internals;
}
function isWorkerLegal(board, side, move) {
  const r = { inBounds: false, rightSide: false, inLegalSet: false, detail: '' };
  if (!move || !move.from || !move.to) { r.detail = 'move null/malformed'; return r; }
  const fr = move.from.row, fc = move.from.col, tr = move.to.row, tc = move.to.col;
  if (fr < 0 || fr > 9 || fc < 0 || fc > 8 || tr < 0 || tr > 9 || tc < 0 || tc > 8) { r.detail = 'out of bounds'; return r; }
  r.inBounds = true;
  const p = board[fr][fc];
  if (!p || p.side !== side) { r.detail = 'no own piece at from'; return r; }
  r.rightSide = true;
  const set = WORKER_INTF.getAllLegalMoves(board, side);
  r.inLegalSet = set.some((m) => m.from.row === fr && m.from.col === fc && m.to.row === tr && m.to.col === tc);
  if (!r.inLegalSet) r.detail = 'move not in getAllLegalMoves (illegal/leave-king-in-check)';
  return r;
}

// ---------------- mock Worker 工厂 ----------------
function makeMockWorker(kind) {
  const instances = [];
  const K = class MockWorker {
    constructor(url) {
      if (kind === 'fail') throw new Error('Worker unavailable in this WebView');
      this.url = url; this._h = { message: [], error: [] }; this._posts = [];
      instances.push(this);
    }
    addEventListener(t, fn) { (this._h[t] = this._h[t] || []).push(fn); }
    removeEventListener(t, fn) { const a = this._h[t]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
    postMessage(data) {
      this._posts.push(data);
      if (kind === 'success') {
        const deadline = Date.now() + (data.budget || 380);
        const mv = WORKER_INTF.findBestMove(data.board, data.side, data.depth || 2, deadline);
        const ev = { data: { reqId: data.reqId, move: mv } };
        this._h.message.slice().forEach((fn) => fn(ev));
      } else if (kind === 'error') {
        const ev = { message: 'worker crashed' };
        this._h.error.slice().forEach((fn) => fn(ev));
      }
      // 'timeout' 与 'manual'：不主动回调，交由测试控制
    }
    terminate() {}
  };
  K._instances = instances;
  return K;
}

// ---------------- 加载真实 game.js（DOM mock 环境，导出内部函数） ----------------
function makeDOM() {
  let clock = 1000;
  function makeCtx() {
    return new Proxy({}, {
      get(t, p) {
        if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
        if (p === 'measureText') return () => ({ width: 10 });
        return () => {};
      },
      set() { return true; }
    });
  }
  const ctxMock = makeCtx();
  function makeEl(id) {
    const h = {};
    return {
      id, _handlers: h,
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      style: {}, dataset: {}, textContent: '', innerHTML: '', value: '', width: 0, height: 0, lastChild: null, onclick: null,
      addEventListener(t, f) { (h[t] = h[t] || []).push(f); }, removeEventListener() {},
      appendChild() {}, removeChild() {}, getContext() { return ctxMock; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 490, height: 588 }; },
      querySelectorAll() { return []; }, focus() {}
    };
  }
  const elCache = {};
  const getEl = (id) => (elCache[id] = elCache[id] || makeEl(id));
  const diffButtons = ['1', '2', '3'].map((d) => { const b = makeEl('diff' + d); b.dataset = { difficulty: d }; return b; });
  const documentMock = {
    getElementById: (id) => getEl(id),
    createElement: (tag) => (tag === 'canvas' ? makeEl('canvas_created') : makeEl('el_' + tag)),
    querySelectorAll: (sel) => (sel === '[data-difficulty]' ? diffButtons : []),
    addEventListener() {}, body: makeEl('body')
  };
  const windowMock = { addEventListener(t, f) { (windowMock._h = windowMock._h || {}); (windowMock._h[t] = windowMock._h[t] || []).push(f); } };
  const navigatorMock = { bluetooth: undefined };
  function rafMock(cb) { clock += 20; return setTimeout(() => cb(clock), 0); }
  const performanceMock = { now: () => clock };
  return { documentMock, windowMock, navigatorMock, rafMock, performanceMock };
}

function loadGame(kind) {
  const dom = makeDOM();
  const MockWorker = makeMockWorker(kind);
  global.Worker = MockWorker;
  const code = fs.readFileSync(JS_GAME, 'utf-8');
  const wrapper = `
  ;globalThis.__G = {
    computeAIMove, syncFallbackMove, getAIWorker, getAllLegalMoves, getLegalMoves,
    findBestMove, createInitialBoard, makeMove, resetGame,
    getState: () => ({ currentSide, aiThinking, aiSide, gameMode })
  };`;
  const fn = new Function(
    'document', 'window', 'navigator', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Math', 'Date', 'JSON', 'console',
    'SpeechSynthesisUtterance', 'TextEncoder', 'confirm', 'alert', 'Worker',
    code + wrapper
  );
  fn(
    dom.documentMock, dom.windowMock, dom.navigatorMock, dom.performanceMock, dom.rafMock, () => {},
    setTimeout, clearTimeout, setInterval, clearInterval, Math, Date, JSON, console,
    class { constructor(t) { this.text = t; } }, TextEncoder, () => true, () => {}, global.Worker
  );
  return global.__G;
}

// setup：为某场景加载一份全新 game.js（模块级 aiWorker/aiWorkerFailed 均为初始态）
function setup(kind, opts = {}) {
  const G = loadGame(kind);
  const board = G.createInitialBoard();
  if (opts.apply) opts.apply.forEach((m) => applyMove(board, m));
  const side = opts.side || 'black';
  const depth = opts.depth || 2;
  const budgetMs = opts.budgetMs != null ? opts.budgetMs : 380;
  const reqId = opts.reqId || 7;
  return {
    G, board, side, depth, budgetMs, reqId,
    computeAIMove: G.computeAIMove,
    MockWorker: global.Worker,
    workerInstance: () => global.Worker._instances[global.Worker._instances.length - 1]
  };
}

// ---------------- Part A：四种情形 ----------------
async function scenSuccess() {
  const s = setup('success', { side: 'black', depth: 2 });
  let calls = 0, move = null;
  await new Promise((res) => {
    s.computeAIMove(s.board, s.side, s.depth, s.budgetMs, s.reqId, (mv) => { calls++; move = mv; setImmediate(res); });
  });
  check(calls === 1, 'Worker成功: onMove 恰好回调一次', 'calls=' + calls);
  check(isLegalMove(s.board, s.side, move), 'Worker成功: 返回合法着法', JSON.stringify(move));
  const w = s.workerInstance();
  check(w && w._posts.length === 1 && w._posts[0].reqId === s.reqId, 'Worker成功: 正确 postMessage(reqId/depth/budget)', w && JSON.stringify(w._posts[0] && { reqId: w._posts[0].reqId, depth: w._posts[0].depth, budget: w._posts[0].budget }));
}

async function scenError() {
  const s = setup('error', { side: 'black', depth: 2 });
  let calls = 0, move = null;
  await new Promise((res) => {
    s.computeAIMove(s.board, s.side, s.depth, s.budgetMs, s.reqId, (mv) => { calls++; move = mv; setImmediate(res); });
  });
  check(calls === 1, 'Worker抛错: onMove 恰好回调一次（主线程兜底链路不断裂）', 'calls=' + calls);
  check(isLegalMove(s.board, s.side, move), 'Worker抛错: 返回合法着法（降级随机走法）', JSON.stringify(move));
}

async function scenFail() {
  const s = setup('fail', { side: 'black', depth: 1 });
  let calls = 0, move = null;
  await new Promise((res) => {
    s.computeAIMove(s.board, s.side, s.depth, s.budgetMs, s.reqId, (mv) => { calls++; move = mv; setImmediate(res); });
  });
  check(calls === 1, 'Worker加载失败: onMove 同步回调一次（降级主线程计算）', 'calls=' + calls);
  check(isLegalMove(s.board, s.side, move), 'Worker加载失败: 返回合法着法', JSON.stringify(move));
}

async function scenTimeout() {
  const s = setup('timeout', { side: 'black', depth: 1, budgetMs: 100 }); // 硬超时 = max(2000, 100*4)=2000ms
  let calls = 0, move = null, timedOut = false;
  const p = new Promise((res) => {
    s.computeAIMove(s.board, s.side, s.depth, s.budgetMs, s.reqId, (mv) => { calls++; move = mv; setImmediate(res); });
  });
  const guard = new Promise((res) => setTimeout(() => { timedOut = true; res(); }, 4000));
  await Promise.race([p, guard]);
  check(!timedOut, 'Worker超时: 在 4s 内回调（不卡死、不无限等待）', 'timedOut=' + timedOut);
  check(calls === 1, 'Worker超时: onMove 恰好回调一次（硬超时兜底）', 'calls=' + calls);
  check(isLegalMove(s.board, s.side, move), 'Worker超时: 返回合法着法（兜底）', JSON.stringify(move));
}

// ---------------- Part A2：边界 ----------------
async function edgeStaleReqId() {
  const s = setup('manual', { side: 'black', depth: 2, reqId: 7 });
  let calls = 0, move = null;
  await new Promise((res) => {
    s.computeAIMove(s.board, s.side, s.depth, s.budgetMs, s.reqId, (mv) => { calls++; move = mv; setImmediate(res); });
    const w = s.workerInstance();
    // 1) 过期 reqId -> 必须被忽略，不回调
    w._h.message.slice().forEach((fn) => fn({ data: { reqId: 12345, move: { from: { row: 0, col: 0 }, to: { row: 1, col: 1 } } } }));
    // 2) 正确 reqId -> 回调一次
    w._h.message.slice().forEach((fn) => fn({ data: { reqId: 7, move: { from: { row: 2, col: 1 }, to: { row: 6, col: 1 } } } }));
  });
  check(calls === 1, '过期reqId: 仅正确 reqId 触发一次回调（旧响应被忽略）', 'calls=' + calls);
  check(move && move.from.row === 2 && move.from.col === 1 && move.to.row === 6 && move.to.col === 1,
    '过期reqId: 交付的是正确 reqId 对应的着法', JSON.stringify(move));
}

async function edgeDoubleMessage() {
  const s = setup('manual', { side: 'black', depth: 2, reqId: 7 });
  let calls = 0, move = null;
  await new Promise((res) => {
    s.computeAIMove(s.board, s.side, s.depth, s.budgetMs, s.reqId, (mv) => { calls++; move = mv; setImmediate(res); });
    const w = s.workerInstance();
    const ev = { data: { reqId: 7, move: { from: { row: 2, col: 1 }, to: { row: 6, col: 1 } } } };
    w._h.message.slice().forEach((fn) => fn(ev)); // 第一次：settle 并 removeEventListener
    w._h.message.slice().forEach((fn) => fn(ev)); // 第二次：侦听器已移除，应为空操作
  });
  check(calls === 1, '重复消息: settled 守卫确保只回调一次（不丢/不重复）', 'calls=' + calls);
}

// ---------------- Part B：ai.worker.js 引擎正确性 ----------------
function partB() {
  const positions = [
    { name: '初始(黑)', build: () => initialBoard(), side: 'black', depth: 3 },
    { name: '初始(红)', build: () => initialBoard(), side: 'red', depth: 3 },
    { name: '中局(黑)', build: () => { const b = initialBoard(); applyMove(b, { fr: 7, fc: 1, tr: 7, tc: 4 }); applyMove(b, { fr: 2, fc: 1, tr: 2, tc: 4 }); return b; }, side: 'black', depth: 3 },
    { name: '残局双车(黑)', build: () => { const b = emptyBoard(); b[0][4] = { type: 'king', side: 'black' }; b[9][4] = { type: 'king', side: 'red' }; b[5][0] = { type: 'chariot', side: 'red' }; b[6][8] = { type: 'chariot', side: 'red' }; return b; }, side: 'black', depth: 3 },
    { name: '困难深度3(黑)', build: () => initialBoard(), side: 'black', depth: 3 }
  ];
  for (const pos of positions) {
    const board = pos.build();
    WORKER_SELF._posted = null;
    const t0 = Date.now();
    WORKER_SELF.onmessage({ data: { reqId: 1, board, side: pos.side, depth: pos.depth, budget: 550 } });
    const dt = Date.now() - t0;
    const move = WORKER_SELF._posted && WORKER_SELF._posted.move;
    const legal = isWorkerLegal(board, pos.side, move);
    check(!!move && legal.inBounds && legal.rightSide && legal.inLegalSet,
      'worker[' + pos.name + ']: 返回合法着法(' + dt + 'ms)', JSON.stringify(move) + (legal.detail ? (' :: ' + legal.detail) : ''));
    // 落子后仍是合法局面（能正常应用、不抛异常、棋子确实移动）
    if (move && legal.inBounds && legal.rightSide) {
      let applied = true;
      try {
        const p = board[move.from.row][move.from.col];
        board[move.to.row][move.to.col] = p;
        board[move.from.row][move.from.col] = null;
        if (board[move.to.row][move.to.col] !== p) applied = false;
      } catch (e) { applied = false; }
      check(applied, 'worker[' + pos.name + ']: 落子后局面有效（无崩溃）');
    } else {
      check(false, 'worker[' + pos.name + ']: 落子后局面有效（无崩溃）', 'move 非法，跳过');
    }
  }
}

// ---------------- Part C：文件一致 & 语法 ----------------
function partC() {
  const pairs = [['js/game.js', 'www/js/game.js'], ['js/ai.worker.js', 'www/js/ai.worker.js']];
  for (const [a, b] of pairs) {
    const ba = fs.readFileSync(path.join(ROOT, a));
    const bb = fs.readFileSync(path.join(ROOT, b));
    check(ba.equals(bb), a + ' 与 ' + b + ' 字节一致', 'size ' + ba.length + ' vs ' + bb.length);
  }
  for (const f of ['js/game.js', 'www/js/game.js', 'js/ai.worker.js', 'www/js/ai.worker.js']) {
    let ok = true, err = '';
    try { execFileSync('node', ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); }
    catch (e) { ok = false; err = (e.stderr ? e.stderr.toString() : '') + (e.stdout ? e.stdout.toString() : '') || e.message; }
    check(ok, 'node --check 通过: ' + f, err.trim());
  }
}

// ---------------- Part D：Android 部署产物一致性（cap sync 后必须同步） ----------------
function partD() {
  const ANDROID = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public');
  const ag = path.join(ANDROID, 'js', 'game.js');
  const aw = path.join(ANDROID, 'js', 'ai.worker.js');
  // 部署产物必须存在且与 www/ 字节一致（否则 APK 内仍是旧代码 / 缺 Worker，修复无效）
  if (!fs.existsSync(ag)) {
    check(false, 'Android 部署产物存在: ' + path.relative(ROOT, ag), '文件缺失');
  } else {
    const a = fs.readFileSync(ag); const w = fs.readFileSync(WWW_GAME);
    check(a.equals(w), 'Android game.js 与 www/js/game.js 字节一致（即含 Worker 修复）', 'size ' + a.length + ' vs ' + w.length);
    const s = a.toString();
    check(s.includes('computeAIMove') && s.includes('getAIWorker') && s.includes('ai.worker.js'),
      'Android game.js 含 Worker 修复代码(computeAIMove/getAIWorker)', '缺失 Worker 修复');
  }
  if (!fs.existsSync(aw)) {
    check(false, 'Android 部署产物存在: ' + path.relative(ROOT, aw), 'Worker 文件缺失 —— new Worker 在设备上必失败，回退主线程→原崩溃复现');
  } else {
    const a = fs.readFileSync(aw); const w = fs.readFileSync(WWW_WORKER);
    check(a.equals(w), 'Android ai.worker.js 与 www/js/ai.worker.js 字节一致', 'size ' + a.length + ' vs ' + w.length);
  }
}

// ---------------- 主流程 ----------------
async function main() {
  loadWorkerEngine();

  section('A. computeAIMove — 四种 Worker 情形（mock Worker 驱动真实异步链路）');
  await scenFail();
  await scenSuccess();
  await scenError();
  await scenTimeout();

  section('A2. computeAIMove — 边界（过期 reqId / 重复消息）');
  await edgeStaleReqId();
  await edgeDoubleMessage();

  section('B. ai.worker.js 引擎正确性（初始/中局/残局/困难深度3）');
  partB();

  section('C. 文件字节一致 & node --check 语法校验');
  partC();

  section('D. Android 部署产物一致性（cap sync 后必须同步，否则修复不生效）');
  partD();

  console.log('\n================ 汇总 ================');
  console.log('PASS = ' + passCount + '   FAIL = ' + failCount);
  if (failures.length) { console.log('失败项:'); failures.forEach((f) => console.log('  - ' + f)); }
  console.log(failCount === 0 ? '==== 全部通过 ====' : '==== 存在失败 ====');
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => { console.error('测试框架异常:', e); process.exit(2); });
