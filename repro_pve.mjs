// 集成复现：在 DOM mock 下加载真实 game.js，驱动完整 PVE 流程
// （进入人机 → 玩家走子 → AI 思考 → AI 走子 → 动画 → 回到玩家），
// 捕获 PVE 路径上任何 JS 异常 / 未处理 reject / 卡死。

import fs from 'fs';

// ---------- DOM / 浏览器环境 mock ----------
let clock = 1000; // 模拟 performance.now() 的单调时钟

function makeCtx() {
    return new Proxy({}, {
        get(t, prop) {
            if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
                return () => ({ addColorStop() {} });
            }
            if (prop === 'measureText') return () => ({ width: 10 });
            return (..._args) => {};
        },
        set() { return true; }
    });
}

const ctxMock = makeCtx();

function makeEl(id) {
    const handlers = {};
    const el = {
        id,
        _handlers: handlers,
        classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
        style: {},
        dataset: {},
        textContent: '',
        innerHTML: '',
        value: '',
        width: 0,
        height: 0,
        lastChild: null,
        onclick: null,
        addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
        removeEventListener() {},
        appendChild() {},
        removeChild() {},
        getContext() { return ctxMock; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 490, height: 588 }; },
        querySelectorAll() { return []; },
        focus() {}
    };
    return el;
}

const elCache = {};
function getEl(id) { return (elCache[id] = elCache[id] || makeEl(id)); }

// 难度按钮
const diffButtons = ['1', '2', '3'].map(d => {
    const b = makeEl('diff' + d);
    b.dataset = { difficulty: d };
    return b;
});

const documentMock = {
    getElementById: (id) => getEl(id),
    createElement: (tag) => {
        if (tag === 'canvas') {
            const c = makeEl('canvas_created');
            return c;
        }
        return makeEl('el_' + tag);
    },
    querySelectorAll: (sel) => {
        if (sel === '[data-difficulty]') return diffButtons;
        return [];
    },
    addEventListener() {},
    body: makeEl('body')
};

const windowMock = {
    addEventListener(type, fn) { (windowMock._h = windowMock._h || {}); (windowMock._h[type] = windowMock._h[type] || []).push(fn); }
};

const navigatorMock = { bluetooth: undefined };

// requestAnimationFrame：推进时钟并尽快回调，让动画循环收敛
function rafMock(cb) {
    clock += 20;
    return setTimeout(() => cb(clock), 0);
}
function cafMock() {}

const performanceMock = { now: () => clock };

class SpeechSynthesisUtteranceMock { constructor(t) { this.text = t; } }

// ---------- 加载真实 game.js ----------
const code = fs.readFileSync('D:/Users/78731/AppData/Local/Programs/xiangqi/js/game.js', 'utf-8');

const wrapper = `
;globalThis.__exports = {
    handleClick, makeMove, scheduleAI, findBestMove, resetGame,
    getState: () => ({ currentSide, aiThinking, aiSide, gameMode, aiDepth,
        boardCount: (() => { let n=0; for (let r=0;r<10;r++) for(let c=0;c<9;c++) if (board[r][c]) n++; return n; })() })
};
`;

// window/全局对象：把浏览器全局作为函数参数注入
const fn = new Function(
    'document','window','navigator','performance','requestAnimationFrame','cancelAnimationFrame',
    'setTimeout','clearTimeout','setInterval','clearInterval','Math','Date','JSON','console',
    'SpeechSynthesisUtterance','TextEncoder','confirm','alert',
    code + wrapper
);

let loadError = null;
try {
    fn(
        documentMock, windowMock, navigatorMock, performanceMock, rafMock, cafMock,
        setTimeout, clearTimeout, setInterval, clearInterval,
        Math, Date, JSON, console, SpeechSynthesisUtteranceMock, TextEncoder,
        () => true, () => {}
    );
} catch (e) {
    loadError = e;
}

const G = globalThis.__exports;

// ---------- 异步异常捕获 ----------
let asyncError = null;
process.on('uncaughtException', (e) => { asyncError = e; console.error('!! uncaughtException:', e.stack || e.message); });
process.on('unhandledRejection', (e) => { asyncError = e; console.error('!! unhandledRejection:', e.stack || e.message); });

(async () => {
    if (loadError) {
        console.log('!! 加载 game.js 抛异常:', loadError.stack || loadError.message);
        process.exit(3);
    }
    console.log('[OK] game.js 加载成功，无顶层异常');

    // 1) 模拟点击「人机对战」→ 难度「困难」按钮
    const diff3 = diffButtons.find(b => b.dataset.difficulty === '3');
    if (!diff3 || !diff3._handlers.click) { console.log('!! 未找到难度按钮 click 处理器'); process.exit(4); }
    try {
        diff3._handlers.click[0]();
        console.log('[OK] 进入 PVE(困难)，状态:', JSON.stringify(G.getState()));
    } catch (e) {
        console.log('!! 进入 PVE 抛异常:', e.stack || e.message); process.exit(5);
    }

    // 2) 玩家(红方)走一步：炮二平五 (7,1)->(7,4)
    try {
        G.makeMove(7, 1, 7, 4, false);
        console.log('[OK] 玩家走子完成，触发 AI 思考调度');
    } catch (e) {
        console.log('!! 玩家走子抛异常:', e.stack || e.message); process.exit(6);
    }

    // 3) 等待 AI 思考 + 走子 + 动画（让事件循环跑 3 秒）
    await new Promise(res => setTimeout(res, 3000));

    console.log('[INFO] 3 秒后状态:', JSON.stringify(G.getState()));

    if (asyncError) {
        console.log('\n=== 结果: FAIL (PVE 路径抛出了未捕获异常) ===');
        process.exit(7);
    }
    if (G.getState().boardCount !== 32) {
        console.log('\n!! 棋子数异常:', G.getState().boardCount, '(应为 32)');
        console.log('=== 结果: FAIL (棋盘状态被破坏) ===');
        process.exit(8);
    }
    console.log('\n=== 结果: PASS (PVE 全流程无异常/无卡死，棋子数正常) ===');
    process.exit(0);
})();
