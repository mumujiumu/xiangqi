// 校验 ai.worker.js 的纯引擎：用模拟 self 加载，post 若干棋局，验证返回合法着法。
import fs from 'fs';

const code = fs.readFileSync('D:/Users/78731/AppData/Local/Programs/xiangqi/js/ai.worker.js', 'utf-8');

let posted = null;
const selfMock = {
    _onmsg: null,
    set onmessage(fn) { this._onmsg = fn; },
    get onmessage() { return this._onmsg; },
    postMessage(m) { posted = m; }
};
globalThis.self = selfMock;

// 加载 worker（会设置 self.onmessage）
new Function(code)();

function createInitialBoard() {
    const b = Array.from({ length: 10 }, () => Array(9).fill(null));
    const blackBack = ['chariot','horse','elephant','advisor','king','advisor','elephant','horse','chariot'];
    blackBack.forEach((t, c) => b[0][c] = { type: t, side: 'black' });
    b[2][1] = { type: 'cannon', side: 'black' };
    b[2][7] = { type: 'cannon', side: 'black' };
    [0,2,4,6,8].forEach(c => b[3][c] = { type: 'pawn', side: 'black' });
    const redBack = ['chariot','horse','elephant','advisor','king','advisor','elephant','horse','chariot'];
    redBack.forEach((t, c) => b[9][c] = { type: t, side: 'red' });
    b[7][1] = { type: 'cannon', side: 'red' };
    b[7][7] = { type: 'cannon', side: 'red' };
    [0,2,4,6,8].forEach(c => b[6][c] = { type: 'pawn', side: 'red' });
    return b;
}
function isLegal(b, side, m) {
    // 简易校验：目标格为空或敌子，且走子后己方不被将军（用 worker 内 getLegalMoves 不便，这里只校验落点在界内）
    if (!m || !m.from || !m.to) return false;
    const { row: fr, col: fc } = m.from, { row: tr, col: tc } = m.to;
    if (fr<0||fr>9||fc<0||fc>8||tr<0||tr>9||tc<0||tc>8) return false;
    const p = b[fr][fc];
    if (!p || p.side !== side) return false;
    const t = b[tr][tc];
    if (t && t.side === side) return false;
    return true;
}

const cases = [
    { name: '初始(黑)', board: createInitialBoard(), side: 'black', depth: 3 },
    { name: '初始(红)', board: createInitialBoard(), side: 'red', depth: 3 },
    { name: '困难深度3', board: createInitialBoard(), side: 'black', depth: 3 },
    { name: '简单深度1', board: createInitialBoard(), side: 'black', depth: 1 },
    { name: '残局双车', board: (() => { const b=Array.from({length:10},()=>Array(9).fill(null)); b[0][4]={type:'king',side:'black'}; b[9][4]={type:'king',side:'red'}; b[5][0]={type:'chariot',side:'red'}; b[6][8]={type:'chariot',side:'red'}; return b; })(), side: 'black', depth: 3 },
];

let pass = true;
for (const c of cases) {
    posted = null;
    const t0 = Date.now();
    selfMock.onmessage({ data: { reqId: 1, board: c.board, side: c.side, depth: c.depth, budget: 550 } });
    const dt = Date.now() - t0;
    const ok = posted && posted.reqId === 1 && isLegal(c.board, c.side, posted.move);
    if (!ok) pass = false;
    console.log(`[${ok?'OK':'FAIL'}] ${c.name} depth=${c.depth} -> ${dt}ms move=${posted && posted.move ? `(${posted.move.from.row},${posted.move.from.col})->(${posted.move.to.row},${posted.move.to.col})` : 'null'}`);
}
console.log('\n=== Worker 引擎校验:', pass ? 'ALL PASS' : 'FAIL', '===');
process.exit(pass ? 0 : 1);
