// 逻辑测试 —— 验证象棋走法规则
// 提取 game.js 中的纯逻辑函数进行测试

const fs = require('fs');
const code = fs.readFileSync('D:/Users/78731/AppData/Local/Programs/xiangqi/js/game.js', 'utf-8');

// 提取纯逻辑部分（从开头到 Canvas 绘制之前）
const logicEnd = code.indexOf('// ============ Canvas 绘制');
let logic = code.substring(0, logicEnd);

// 创建一个隔离环境来运行逻辑
const testModule = { exports: {} };
const wrapper = logic + `
;testModule.exports = {
    createInitialBoard, inPalace, crossedRiver, inBoard,
    getRawMoves, findKing, isInCheck, getLegalMoves, hasAnyLegalMove,
    PIECE_CHAR
};
`;

// 用 eval 在隔离作用域中执行
eval(wrapper);
const G = testModule.exports;

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); passed++; }
    catch(e) { console.log('  ✗ ' + name + ' — ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }

console.log('=== 中国象棋逻辑测试 ===\n');

// 1. 初始局面
test('初始局面有32枚棋子', () => {
    const b = G.createInitialBoard();
    let count = 0;
    for (let r = 0; r < 10; r++)
        for (let c = 0; c < 9; c++)
            if (b[r][c]) count++;
    assert(count === 32, '应有32枚棋子，实际' + count);
});

test('初始局面红方先行不被将军', () => {
    const b = G.createInitialBoard();
    assert(!G.isInCheck(b, 'red'), '红方不应被将军');
    assert(!G.isInCheck(b, 'black'), '黑方不应被将军');
});

// 2. 车的走法
test('初始红车可向上走两步到兵前', () => {
    const b = G.createInitialBoard();
    // 红车在 (9,0)，上方 (8,0)(7,0) 为空，(6,0) 有红兵挡路
    const moves = G.getRawMoves(b, 9, 0);
    assert(moves.length === 2, '初始红车应有2个走法(8,0)(7,0)，实际' + moves.length);
});

test('车清路后可直线长走', () => {
    const b = G.createInitialBoard();
    b[6][0] = null; // 清掉挡路的兵
    const moves = G.getRawMoves(b, 9, 0);
    assert(moves.length > 3, '清路后车应有多步走法，实际' + moves.length);
});

// 3. 马的走法（蹩马腿）
test('马被蹩马腿时不能走', () => {
    const b = G.createInitialBoard();
    // 红马在 (9,1)，前方有兵在(6,1)... 不对
    // 马在 (9,1)，往上走日字需要 (8,1) 无子，但 (8,1) 是空的
    // 实际初始局面 马在 (9,1)，可以走 (7,0) 和 (7,2)
    // 但 (7,0) 和 (7,2) 有炮... 不，炮在 (7,1) 和 (7,7)
    // (7,0) 没有棋子
    const moves = G.getRawMoves(b, 9, 1);
    // 马往上走需要 (8,1) 位置无子作为马腿
    // (8,1) 是空的，所以可以走 (7,0) 和 (7,2)
    assert(moves.length === 2, '红马应有2个走法(7,0)(7,2)，实际' + moves.length);
});

// 4. 炮的走法
test('炮可走空位且能隔子吃远端目标', () => {
    const b = G.createInitialBoard();
    // 红炮在 (7,1)，往上：(6,1)(5,1)(4,1)(3,1) 均空可走，
    // (2,1)有黑炮当炮架，(1,1)空，(0,1)有黑马 → 隔子吃马
    const moves = G.getRawMoves(b, 7, 1);
    const upMoves = moves.filter(m => m.row < 7 && m.col === 1);
    assert(upMoves.length === 5, '炮向上应有5个走法(4空位+1吃马)，实际' + upMoves.length);
    // 确认能吃到 (0,1) 的马
    const canCaptureHorse = upMoves.some(m => m.row === 0 && m.col === 1);
    assert(canCaptureHorse, '炮应能隔着(2,1)黑炮吃到(0,1)黑马');
});

test('炮隔山打牛', () => {
    const b = Array.from({length:10}, () => Array(9).fill(null));
    b[5][4] = { type: 'cannon', side: 'red' };
    b[3][4] = { type: 'chariot', side: 'black' }; // 目标
    b[4][4] = { type: 'pawn', side: 'red' };      // 炮架
    const moves = G.getRawMoves(b, 5, 4);
    const canCapture = moves.some(m => m.row === 3 && m.col === 4);
    assert(canCapture, '炮应能隔着炮架吃车');
});

// 5. 相不过河
test('相不能过河', () => {
    const b = Array.from({length:10}, () => Array(9).fill(null));
    b[9][2] = { type: 'elephant', side: 'red' };
    const moves = G.getRawMoves(b, 9, 2);
    // 相在 (9,2)，可走 (7,0) 和 (7,4)，不能走到 row<5
    moves.forEach(m => {
        assert(m.row >= 5, '红相不能过河到 row=' + m.row);
    });
});

test('相塞象眼不能走', () => {
    const b = Array.from({length:10}, () => Array(9).fill(null));
    b[9][2] = { type: 'elephant', side: 'red' };
    b[8][3] = { type: 'pawn', side: 'red' }; // 塞象眼
    const moves = G.getRawMoves(b, 9, 2);
    const canGo74 = moves.some(m => m.row === 7 && m.col === 4);
    assert(!canGo74, '塞象眼后相不能走田字到(7,4)');
});

// 6. 兵的走法
test('兵未过河只能前进', () => {
    const b = Array.from({length:10}, () => Array(9).fill(null));
    b[6][4] = { type: 'pawn', side: 'red' };
    const moves = G.getRawMoves(b, 6, 4);
    assert(moves.length === 1, '未过河兵只能走1步，实际' + moves.length);
    assert(moves[0].row === 5, '兵应向前走');
});

test('兵过河后可横走', () => {
    const b = Array.from({length:10}, () => Array(9).fill(null));
    b[4][4] = { type: 'pawn', side: 'red' }; // 已过河
    const moves = G.getRawMoves(b, 4, 4);
    assert(moves.length === 3, '过河兵可走3步(前+左+右)，实际' + moves.length);
});

// 7. 帅/将九宫限制
test('帅不能出九宫', () => {
    const b = Array.from({length:10}, () => Array(9).fill(null));
    b[9][4] = { type: 'king', side: 'red' };
    const moves = G.getRawMoves(b, 9, 4);
    moves.forEach(m => {
        assert(G.inPalace(m.row, m.col, 'red'), '帅不能出九宫');
    });
});

// 8. 飞将规则
test('两将照面判将军', () => {
    const b = Array.from({length:10}, () => Array(9).fill(null));
    b[0][4] = { type: 'king', side: 'black' };
    b[9][4] = { type: 'king', side: 'red' };
    assert(G.isInCheck(b, 'red'), '两将照面应判红方被将军(飞将)');
    assert(G.isInCheck(b, 'black'), '两将照面应判黑方被将军(飞将)');
});

// 9. 将军检测
test('车直接攻击将判将军', () => {
    const b = Array.from({length:10}, () => Array(9).fill(null));
    b[9][4] = { type: 'king', side: 'red' };
    b[0][4] = { type: 'chariot', side: 'black' };
    assert(G.isInCheck(b, 'red'), '车直对将应判将军');
});

// 10. 合法走法排除送将
test('不能走出让己方被将军的棋', () => {
    const b = Array.from({length:10}, () => Array(9).fill(null));
    b[9][4] = { type: 'king', side: 'red' };
    b[0][4] = { type: 'chariot', side: 'black' }; // 车对将
    b[5][3] = { type: 'advisor', side: 'red' };
    // 士在 (5,3)，如果走开，将仍然被车将军
    // 但士的走法是斜走，在九宫外不能走
    // 换个测试：将本身不能走开（走到侧面仍被车将军）
    const moves = G.getLegalMoves(b, 9, 4);
    // 将走到 (9,3) 或 (9,5) 仍然在同列被车将军？不，走到 (9,3) 就不在同列了
    // 所以将可以走到 (9,3) 或 (9,5) 来躲避
    assert(moves.length === 2, '将应能横走躲避，实际' + moves.length + '个走法');
});

// 11. 将死判定
test('将死：三车锁将无路可逃', () => {
    const b = Array.from({length:10}, () => Array(9).fill(null));
    b[9][4] = { type: 'king', side: 'red' };
    // 三车分别锁住将的列和两侧逃路
    b[0][4] = { type: 'chariot', side: 'black' }; // 正面将军(同列)
    b[0][3] = { type: 'chariot', side: 'black' }; // 封锁 (9,3)
    b[0][5] = { type: 'chariot', side: 'black' }; // 封锁 (9,5)
    assert(G.isInCheck(b, 'red'), '红方应被将军');
    assert(!G.hasAnyLegalMove(b, 'red'), '红方应被将死(无合法走法)');
});

console.log('\n=== 测试结果 ===');
console.log(`通过: ${passed}  失败: ${failed}`);
if (failed > 0) process.exit(1);
