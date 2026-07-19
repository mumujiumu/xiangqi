/*
 * 中国象棋 · 游戏引擎
 * 棋盘坐标：board[row][col]，row 0-9（上到下），col 0-8（左到右）
 * 黑方在上（row 0-4），红方在下（row 5-9）
 *
 * 游戏模式：pvp（双人）、pve（人机）、bluetooth（蓝牙）
 */

// ============ 棋子定义 ============
const PIECE_CHAR = {
    red:   { king: '帥', advisor: '仕', elephant: '相', horse: '馬', chariot: '車', cannon: '炮', pawn: '兵' },
    black: { king: '將', advisor: '士', elephant: '象', horse: '馬', chariot: '車', cannon: '砲', pawn: '卒' }
};

// 初始局面
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

// ============ 游戏状态 ============
let board, currentSide, selected, validMoves, history, captured;
let flipped = false;

// 模式管理
let gameMode = 'pvp';   // 'pvp' | 'pve' | 'bluetooth'
let aiSide = 'black';   // AI 执黑
let aiDepth = 3;        // AI 搜索深度
let aiThinking = false;
let bluetoothSide = 'red'; // 蓝牙模式中本地玩家执方

// 动画状态
let animating = false;
let animState = null;  // { piece, fromR, fromC, toR, toC, startTime, duration, captured }

// 语音播报（静音开关）
let soundEnabled = true;

function resetGame() {
    board = createInitialBoard();
    currentSide = 'red';
    selected = null;
    validMoves = [];
    history = [];
    captured = { red: [], black: [] };
    aiThinking = false;
    updateUI();
    render();

    // 如果AI执红，先走
    if (gameMode === 'pve' && aiSide === 'red') {
        scheduleAI();
    }
}

// ============ 棋盘常量 ============
const CELL = 56;
const OFFSET_X = 42;
const OFFSET_Y = 42;
const BOARD_W = OFFSET_X * 2 + 8 * CELL;  // 490
const BOARD_H = OFFSET_Y * 2 + 9 * CELL;  // 588

function posToPixel(row, col) {
    const r = flipped ? 9 - row : row;
    const c = flipped ? 8 - col : col;
    return { x: OFFSET_X + c * CELL, y: OFFSET_Y + r * CELL };
}

function pixelToPos(x, y) {
    let c = Math.round((x - OFFSET_X) / CELL);
    let r = Math.round((y - OFFSET_Y) / CELL);
    if (flipped) { r = 9 - r; c = 8 - c; }
    if (r < 0 || r > 9 || c < 0 || c > 8) return null;
    return { row: r, col: c };
}

// ============ 走法规则 ============
function inPalace(row, col, side) {
    if (col < 3 || col > 5) return false;
    if (side === 'red') return row >= 7 && row <= 9;
    return row >= 0 && row <= 2;
}

function crossedRiver(row, side) {
    return side === 'red' ? row <= 4 : row >= 5;
}

function inBoard(r, c) { return r >= 0 && r <= 9 && c >= 0 && c <= 8; }

function getRawMoves(b, row, col) {
    const piece = b[row][col];
    if (!piece) return [];
    const { type, side } = piece;
    const moves = [];
    const enemy = side === 'red' ? 'black' : 'red';

    const tryAdd = (r, c) => {
        if (!inBoard(r, c)) return;
        const target = b[r][c];
        if (!target) moves.push({ row: r, col: c });
        else if (target.side === enemy) moves.push({ row: r, col: c });
    };

    switch (type) {
        case 'king': {
            [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc]) => {
                const nr = row + dr, nc = col + dc;
                if (inPalace(nr, nc, side)) tryAdd(nr, nc);
            });
            break;
        }
        case 'advisor': {
            [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr,dc]) => {
                const nr = row + dr, nc = col + dc;
                if (inPalace(nr, nc, side)) tryAdd(nr, nc);
            });
            break;
        }
        case 'elephant': {
            [[-2,-2],[-2,2],[2,-2],[2,2]].forEach(([dr,dc]) => {
                const nr = row + dr, nc = col + dc;
                if (!inBoard(nr, nc)) return;
                if (side === 'red' && nr < 5) return;
                if (side === 'black' && nr > 4) return;
                const mr = row + dr/2, mc = col + dc/2;
                if (b[mr][mc]) return;
                tryAdd(nr, nc);
            });
            break;
        }
        case 'horse': {
            const horseMoves = [
                [-2,-1,-1,0],[-2,1,-1,0],
                [2,-1,1,0],[2,1,1,0],
                [-1,-2,0,-1],[1,-2,0,-1],
                [-1,2,0,1],[1,2,0,1]
            ];
            horseMoves.forEach(([dr,dc,br,bc]) => {
                const nr = row + dr, nc = col + dc;
                if (!inBoard(nr, nc)) return;
                if (b[row + br][col + bc]) return;
                tryAdd(nr, nc);
            });
            break;
        }
        case 'chariot': {
            [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc]) => {
                let nr = row + dr, nc = col + dc;
                while (inBoard(nr, nc)) {
                    const target = b[nr][nc];
                    if (!target) { moves.push({ row: nr, col: nc }); }
                    else { if (target.side === enemy) moves.push({ row: nr, col: nc }); break; }
                    nr += dr; nc += dc;
                }
            });
            break;
        }
        case 'cannon': {
            [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc]) => {
                let nr = row + dr, nc = col + dc;
                let jumped = false;
                while (inBoard(nr, nc)) {
                    const target = b[nr][nc];
                    if (!jumped) {
                        if (!target) moves.push({ row: nr, col: nc });
                        else jumped = true;
                    } else {
                        if (target) {
                            if (target.side === enemy) moves.push({ row: nr, col: nc });
                            break;
                        }
                    }
                    nr += dr; nc += dc;
                }
            });
            break;
        }
        case 'pawn': {
            const forward = side === 'red' ? -1 : 1;
            tryAdd(row + forward, col);
            if (crossedRiver(row, side)) {
                tryAdd(row, col - 1);
                tryAdd(row, col + 1);
            }
            break;
        }
    }
    return moves;
}

function findKing(b, side) {
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = b[r][c];
            if (p && p.type === 'king' && p.side === side) return { row: r, col: c };
        }
    }
    return null;
}

function isInCheck(b, side) {
    const king = findKing(b, side);
    if (!king) return true;
    const enemy = side === 'red' ? 'black' : 'red';

    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = b[r][c];
            if (p && p.side === enemy) {
                const moves = getRawMoves(b, r, c);
                if (moves.some(m => m.row === king.row && m.col === king.col)) return true;
            }
        }
    }

    const ek = findKing(b, enemy);
    if (ek && king.col === ek.col) {
        let blocked = false;
        const lo = Math.min(king.row, ek.row) + 1;
        const hi = Math.max(king.row, ek.row) - 1;
        for (let r = lo; r <= hi; r++) {
            if (b[r][king.col]) { blocked = true; break; }
        }
        if (!blocked) return true;
    }
    return false;
}

function getLegalMoves(b, row, col) {
    const piece = b[row][col];
    if (!piece) return [];
    const raw = getRawMoves(b, row, col);
    return raw.filter(m => {
        const saved = b[m.row][m.col];
        b[m.row][m.col] = piece;
        b[row][col] = null;
        const ok = !isInCheck(b, piece.side);
        b[row][col] = piece;
        b[m.row][m.col] = saved;
        return ok;
    });
}

function hasAnyLegalMove(b, side) {
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = b[r][c];
            if (p && p.side === side) {
                if (getLegalMoves(b, r, c).length > 0) return true;
            }
        }
    }
    return false;
}

// ============ AI 引擎 ============

const PIECE_VALUE = {
    king: 10000, chariot: 900, horse: 400, cannon: 450,
    elephant: 200, advisor: 200, pawn: 100
};

// 位置价值表（红方视角，row 0 = 黑方底线，row 9 = 红方底线）
// 黑方通过翻转获取位置价值
const POS_VALUE = {
    pawn: [
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [ 70, 90,110,130,140,130,110, 90, 70],
        [ 70, 90,110,130,140,130,110, 90, 70],
        [ 50, 70, 90,110,120,110, 90, 70, 50],
        [ 40, 50, 70, 90,100, 90, 70, 50, 40],
        [ 10,  0, 20,  0, 30,  0, 20,  0, 10],
        [ 10,  0, 20,  0, 30,  0, 20,  0, 10],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
    ],
    horse: [
        [  0, -10, 10,  0,  5,  0, 10, -10,  0],
        [  5,  0, 20, 10, 15, 10, 20,   0,  5],
        [ 10, 20, 30, 25, 30, 25, 30,  20, 10],
        [ 15, 25, 35, 40, 45, 40, 35,  25, 15],
        [ 20, 30, 40, 50, 55, 50, 40,  30, 20],
        [ 20, 30, 40, 50, 55, 50, 40,  30, 20],
        [ 15, 25, 35, 40, 45, 40, 35,  25, 15],
        [ 10, 20, 30, 25, 30, 25, 30,  20, 10],
        [  5,  0, 20, 10, 15, 10, 20,   0,  5],
        [  0, -10, 10,  0,  5,  0, 10, -10,  0],
    ],
    chariot: [
        [ 20, 20, 30, 40, 40, 40, 30, 20, 20],
        [ 20, 30, 40, 50, 50, 50, 40, 30, 20],
        [ 30, 40, 50, 55, 55, 55, 50, 40, 30],
        [ 35, 45, 55, 60, 60, 60, 55, 45, 35],
        [ 40, 50, 60, 65, 65, 65, 60, 50, 40],
        [ 40, 50, 60, 65, 65, 65, 60, 50, 40],
        [ 35, 45, 55, 60, 60, 60, 55, 45, 35],
        [ 30, 40, 50, 55, 55, 55, 50, 40, 30],
        [ 25, 35, 45, 50, 50, 50, 45, 35, 25],
        [ 20, 20, 30, 40, 40, 40, 30, 20, 20],
    ],
    cannon: [
        [ 10, 10,  5, 10, 20, 10,  5, 10, 10],
        [ 10, 15, 15, 20, 25, 20, 15, 15, 10],
        [ 15, 20, 25, 30, 35, 30, 25, 20, 15],
        [ 20, 25, 30, 35, 40, 35, 30, 25, 20],
        [ 25, 30, 35, 40, 45, 40, 35, 30, 25],
        [ 25, 30, 35, 40, 45, 40, 35, 30, 25],
        [ 20, 25, 30, 35, 40, 35, 30, 25, 20],
        [ 15, 20, 25, 30, 35, 30, 25, 20, 15],
        [ 10, 15, 15, 20, 25, 20, 15, 15, 10],
        [ 10, 10,  5, 10, 20, 10,  5, 10, 10],
    ],
    elephant: [
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [ 20,  0, 20,  0, 20,  0, 20,  0, 20],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [ 20,  0, 20,  0, 20,  0, 20,  0, 20],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [ 20,  0, 20,  0, 20,  0, 20,  0, 20],
    ],
    advisor: [
        [  0,  0,  0, 20,  0, 20,  0,  0,  0],
        [  0,  0,  0,  0, 25,  0,  0,  0,  0],
        [  0,  0,  0, 20,  0, 20,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0, 20,  0, 20,  0,  0,  0],
        [  0,  0,  0,  0, 25,  0,  0,  0,  0],
        [  0,  0,  0, 20,  0, 20,  0,  0,  0],
    ],
    king: [
        [  0,  0,  0,  5, 15,  5,  0,  0,  0],
        [  0,  0,  0, 10, 20, 10,  0,  0,  0],
        [  0,  0,  0, 10, 20, 10,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0,  0,  0,  0,  0,  0,  0],
        [  0,  0,  0, 10, 20, 10,  0,  0,  0],
        [  0,  0,  0, 10, 20, 10,  0,  0,  0],
        [  0,  0,  0,  5, 15,  5,  0,  0,  0],
    ],
};

// 获取棋子位置价值（自动处理红黑方翻转）
function getPosValue(piece, row, col) {
    const table = POS_VALUE[piece.type];
    if (!table) return 0;
    if (piece.side === 'red') return table[row][col];
    // 黑方翻转：row -> 9-row, col -> 8-col
    return table[9 - row][8 - col];
}

// 评估局面（从 side 方视角）
function evaluateBoard(b, side) {
    let score = 0;
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = b[r][c];
            if (!p) continue;
            const val = PIECE_VALUE[p.type] + getPosValue(p, r, c);
            if (p.side === side) score += val;
            else score -= val;
        }
    }
    return score;
}

// 生成所有合法走法
function getAllLegalMoves(b, side) {
    const moves = [];
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = b[r][c];
            if (p && p.side === side) {
                const legal = getLegalMoves(b, r, c);
                legal.forEach(m => {
                    moves.push({
                        from: { row: r, col: c },
                        to: { row: m.row, col: m.col }
                    });
                });
            }
        }
    }
    return moves;
}

// 走法排序（吃子优先，提高剪枝效率）
function orderMoves(b, moves) {
    return moves.map(m => {
        const target = b[m.to.row][m.to.col];
        const captureVal = target ? PIECE_VALUE[target.type] : 0;
        return { move: m, score: captureVal };
    }).sort((a, b2) => b2.score - a.score).map(x => x.move);
}

// Minimax + Alpha-Beta 剪枝
function minimax(b, depth, alpha, beta, maximizing, aiSide) {
    if (depth === 0) return evaluateBoard(b, aiSide);

    const side = maximizing ? aiSide : (aiSide === 'red' ? 'black' : 'red');
    const moves = orderMoves(b, getAllLegalMoves(b, side));

    if (moves.length === 0) return maximizing ? -99999 : 99999;

    if (maximizing) {
        let maxEval = -Infinity;
        for (const move of moves) {
            const piece = b[move.from.row][move.from.col];
            const captured = b[move.to.row][move.to.col];
            b[move.to.row][move.to.col] = piece;
            b[move.from.row][move.from.col] = null;

            const evalScore = minimax(b, depth - 1, alpha, beta, false, aiSide);

            b[move.from.row][move.from.col] = piece;
            b[move.to.row][move.to.col] = captured;

            maxEval = Math.max(maxEval, evalScore);
            alpha = Math.max(alpha, evalScore);
            if (beta <= alpha) break;
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (const move of moves) {
            const piece = b[move.from.row][move.from.col];
            const captured = b[move.to.row][move.to.col];
            b[move.to.row][move.to.col] = piece;
            b[move.from.row][move.from.col] = null;

            const evalScore = minimax(b, depth - 1, alpha, beta, true, aiSide);

            b[move.from.row][move.from.col] = piece;
            b[move.to.row][move.to.col] = captured;

            minEval = Math.min(minEval, evalScore);
            beta = Math.min(beta, evalScore);
            if (beta <= alpha) break;
        }
        return minEval;
    }
}

// AI 找最佳走法
function findBestMove(b, side, depth) {
    const moves = orderMoves(b, getAllLegalMoves(b, side));
    if (moves.length === 0) return null;

    // 简单难度：有概率随机走（增加趣味性）
    if (depth <= 1 && Math.random() < 0.3) {
        return moves[Math.floor(Math.random() * Math.min(moves.length, 5))];
    }

    let bestMove = moves[0];
    let bestScore = -Infinity;
    const candidates = [];

    for (const move of moves) {
        const piece = b[move.from.row][move.from.col];
        const captured = b[move.to.row][move.to.col];
        b[move.to.row][move.to.col] = piece;
        b[move.from.row][move.from.col] = null;

        const score = minimax(b, depth - 1, -Infinity, Infinity, false, side);

        b[move.from.row][move.from.col] = piece;
        b[move.to.row][move.to.col] = captured;

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
            candidates.length = 0;
            candidates.push(move);
        } else if (score === bestScore) {
            candidates.push(move);
        }
    }

    // 同分走法中随机选一个
    return candidates[Math.floor(Math.random() * candidates.length)] || bestMove;
}

// 调度 AI 走棋（异步，不阻塞 UI）
function scheduleAI() {
    if (gameMode !== 'pve' || currentSide !== aiSide || aiThinking) return;
    aiThinking = true;
    updateUI();
    startAIThinkAnim();

    // 根据难度决定思考延时（毫秒）
    const thinkTime = aiDepth <= 1 ? (600 + Math.random() * 400)
                    : aiDepth === 3 ? (900 + Math.random() * 600)
                    : (1200 + Math.random() * 800);

    setTimeout(() => {
        const move = findBestMove(board, currentSide, aiDepth);
        aiThinking = false;
        if (move) {
            makeMove(move.from.row, move.from.col, move.to.row, move.to.col);
        } else {
            updateUI();
            render();
        }
    }, thinkTime);
}

// AI 思考时的动画循环（跳动省略号）
let aiAnimRunning = false;
function startAIThinkAnim() {
    if (aiAnimRunning) return;
    aiAnimRunning = true;
    function loop() {
        if (!aiThinking) { aiAnimRunning = false; render(); return; }
        render();
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

// ============ 语音播报 ============
const SPEECH_LANG = 'zh-CN';
let speechVoice = null;

// 初始化语音（加载中文女声）
function initSpeech() {
    if (!('speechSynthesis' in window)) return;
    const loadVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        speechVoice = voices.find(v => v.lang === SPEECH_LANG && /female|女/i.test(v.name))
                   || voices.find(v => v.lang === SPEECH_LANG)
                   || voices.find(v => v.lang.startsWith('zh'))
                   || null;
    };
    loadVoice();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoice;
    }
}

// 中文数字
const CN_NUMS = ['一','二','三','四','五','六','七','八','九'];

// 生成走棋语音文本，如 "红方 车二平五"、"黑方 马八进七"、"红方 炮二进五 吃"
function moveText(piece, fromR, fromC, toR, toC, isCapture) {
    const char = PIECE_CHAR[piece.side][piece.type];
    const sideName = piece.side === 'red' ? '红方' : '黑方';
    const fromCol = piece.side === 'red' ? CN_NUMS[8 - fromC] : (fromC + 1);
    const toCol = piece.side === 'red' ? CN_NUMS[8 - toC] : (toC + 1);

    let action;
    if (fromR === toR) {
        action = '平' + toCol;
    } else {
        const forward = piece.side === 'red' ? fromR > toR : fromR < toR;
        const steps = Math.abs(fromR - toR);
        const stepStr = piece.side === 'red' ? CN_NUMS[steps - 1] : steps;
        const isDiagonal = ['horse','elephant','advisor','king'].includes(piece.type);
        const target = isCapture || isDiagonal ? toCol : stepStr;
        action = forward ? '进' + target : '退' + target;
    }
    return `${sideName} ${char}${fromCol}${action}` + (isCapture ? '，吃' : '');
}

// 播报走棋
function speakMove(piece, fromR, fromC, toR, toC, isCapture) {
    if (!soundEnabled || !('speechSynthesis' in window)) return;
    const text = moveText(piece, fromR, fromC, toR, toC, isCapture);
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = SPEECH_LANG;
    utter.rate = 0.95;
    utter.pitch = 1.0;
    utter.volume = 1.0;
    if (speechVoice) utter.voice = speechVoice;
    window.speechSynthesis.cancel();  // 取消上一句
    window.speechSynthesis.speak(utter);
}

// 播报简短提示
function speak(text) {
    if (!soundEnabled || !('speechSynthesis' in window)) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = SPEECH_LANG;
    utter.rate = 1.0;
    if (speechVoice) utter.voice = speechVoice;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
}

// ============ 棋子移动动画 ============
const ANIM_DURATION = 350;  // 每步走棋动画时长（毫秒）

// 启动移动动画，动画结束后回调 onDone
function startMoveAnim(piece, fromR, fromC, toR, toC, captured, onDone) {
    animating = true;
    animState = {
        piece, fromR, fromC, toR, toC, captured,
        startTime: performance.now(),
        duration: ANIM_DURATION
    };

    function frame(now) {
        const t = Math.min(1, (now - animState.startTime) / animState.duration);
        // 缓动函数（ease-out）
        const eased = 1 - Math.pow(1 - t, 3);
        animState.progress = eased;
        render();

        if (t < 1) {
            requestAnimationFrame(frame);
        } else {
            animating = false;
            animState = null;
            render();
            if (onDone) onDone();
        }
    }
    requestAnimationFrame(frame);
}

// ============ 蓝牙对战 ============
const BluetoothManager = {
    connected: false,
    isHost: false,
    device: null,
    characteristic: null,
    server: null,

    isSupported() {
        return typeof window.bluetoothSerial !== 'undefined' ||
               (navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function');
    },

    // 请求蓝牙运行时权限（Android 12+ 需要）
    async requestBluetoothPermissions() {
        return new Promise((resolve, reject) => {
            if (typeof window.cordova === 'undefined' || !cordova.plugins || !cordova.plugins.permissions) {
                // 非 Cordova/Capacitor 环境，直接继续
                resolve();
                return;
            }

            const perms = cordova.plugins.permissions;
            let permissionsList;
            if (typeof device !== 'undefined' && device.platform && device.platform.toLowerCase() === 'android' && parseInt(device.version) >= 12) {
                permissionsList = [
                    perms.BLUETOOTH_CONNECT,
                    perms.BLUETOOTH_SCAN,
                    perms.BLUETOOTH_ADVERTISE
                ];
            } else {
                permissionsList = [
                    perms.ACCESS_FINE_LOCATION,
                    perms.BLUETOOTH,
                    perms.BLUETOOTH_ADMIN
                ];
            }

            perms.requestPermissions(permissionsList, (status) => {
                if (status.hasPermission) {
                    resolve();
                } else {
                    reject(new Error('蓝牙权限被拒绝'));
                }
            }, (err) => {
                reject(new Error('请求蓝牙权限失败: ' + err));
            });
        });
    },

    // 创建房间（作为主机）
    async host() {
        const btStatus = document.getElementById('btStatus');
        btStatus.textContent = '正在请求蓝牙权限...';
        btStatus.className = 'bt-status info';

        try {
            await this.requestBluetoothPermissions();
        } catch (e) {
            btStatus.textContent = '需要蓝牙权限才能对战: ' + e.message;
            btStatus.className = 'bt-status error';
            return;
        }

        btStatus.textContent = '正在创建蓝牙服务...';
        btStatus.className = 'bt-status info';

        if (typeof window.bluetoothSerial !== 'undefined') {
            // Cordova Bluetooth Serial 插件
            try {
                window.bluetoothSerial.enable(
                    () => {
                        btStatus.textContent = '蓝牙已开启，等待对手连接...';
                        btStatus.className = 'bt-status info';
                        this.listenCordova();
                    },
                    (err) => {
                        btStatus.textContent = '无法开启蓝牙: ' + err;
                        btStatus.className = 'bt-status error';
                    }
                );
            } catch (e) {
                btStatus.textContent = '蓝牙初始化失败: ' + e.message;
                btStatus.className = 'bt-status error';
            }
        } else if (navigator.bluetooth) {
            // Web Bluetooth API — 浏览器中仅支持客户端
            btStatus.textContent = 'Web Bluetooth 模式下，请让对方设备搜索并连接本机。';
            btStatus.className = 'bt-status info';
            this.connected = true;
            this.isHost = true;
            bluetoothSide = 'black';
            this.startGame();
        } else {
            btStatus.textContent = '当前环境不支持蓝牙对战，请安装 APK。';
            btStatus.className = 'bt-status error';
        }
    },

    // 加入房间（作为客户端）
    async join() {
        const btStatus = document.getElementById('btStatus');
        btStatus.textContent = '正在请求蓝牙权限...';
        btStatus.className = 'bt-status info';

        try {
            await this.requestBluetoothPermissions();
        } catch (e) {
            btStatus.textContent = '需要蓝牙权限才能对战: ' + e.message;
            btStatus.className = 'bt-status error';
            return;
        }

        btStatus.textContent = '正在搜索设备...';
        btStatus.className = 'bt-status info';

        if (typeof window.bluetoothSerial !== 'undefined') {
            // Cordova 插件：列出已配对设备
            window.bluetoothSerial.list(
                (devices) => {
                    const list = document.getElementById('btDeviceList');
                    list.innerHTML = '';
                    if (devices.length === 0) {
                        btStatus.textContent = '未找到已配对设备，请先在系统设置中配对。';
                        btStatus.className = 'bt-status error';
                        return;
                    }
                    btStatus.textContent = '选择要连接的设备：';
                    devices.forEach((device) => {
                        const btn = document.createElement('button');
                        btn.className = 'bt-device-btn';
                        btn.textContent = device.name || device.address;
                        btn.onclick = () => this.connectCordova(device.address);
                        list.appendChild(btn);
                    });
                },
                (err) => {
                    btStatus.textContent = '搜索失败: ' + err;
                    btStatus.className = 'bt-status error';
                }
            );
        } else if (navigator.bluetooth) {
            // Web Bluetooth API
            try {
                const device = await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true
                });
                btStatus.textContent = '正在连接 ' + (device.name || '设备') + '...';
                this.device = device;
                this.connected = true;
                this.isHost = false;
                bluetoothSide = 'red';
                this.startGame();
            } catch (err) {
                btStatus.textContent = '连接失败: ' + err.message;
                btStatus.className = 'bt-status error';
            }
        } else {
            btStatus.textContent = '当前环境不支持蓝牙对战，请安装 APK。';
            btStatus.className = 'bt-status error';
        }
    },

    // Cordova 插件连接
    connectCordova(address) {
        const btStatus = document.getElementById('btStatus');
        btStatus.textContent = '正在连接...';
        window.bluetoothSerial.connect(
            address,
            () => {
                btStatus.textContent = '连接成功！';
                btStatus.className = 'bt-status success';
                this.connected = true;
                this.isHost = false;
                bluetoothSide = 'red';
                this.listenCordova();
                this.startGame();
            },
            (err) => {
                btStatus.textContent = '连接失败: ' + err;
                btStatus.className = 'bt-status error';
            }
        );
    },

    // 监听 Cordova 蓝牙数据
    listenCordova() {
        if (typeof window.bluetoothSerial === 'undefined') return;
        window.bluetoothSerial.subscribe('\n', (data) => {
            this.onReceive(data);
        }, (err) => {
            console.error('蓝牙订阅失败:', err);
        });
    },

    // 发送数据
    send(data) {
        const msg = JSON.stringify(data) + '\n';
        if (typeof window.bluetoothSerial !== 'undefined') {
            window.bluetoothSerial.write(msg, () => {},
                (err) => console.error('发送失败:', err));
        } else if (this.characteristic) {
            // Web Bluetooth 写入
            const encoder = new TextEncoder();
            this.characteristic.writeValue(encoder.encode(msg));
        }
    },

    // 接收数据
    onReceive(data) {
        try {
            const msg = JSON.parse(data.trim());
            switch (msg.type) {
                case 'move':
                    // 对方走棋，更新本地棋盘
                    if (gameMode === 'bluetooth' && currentSide !== bluetoothSide) {
                        makeMove(msg.from.row, msg.from.col, msg.to.row, msg.to.col, true);
                    }
                    break;
                case 'undo_request':
                    if (confirm('对方请求悔棋，是否同意？')) {
                        this.send({ type: 'undo_approve' });
                        undoMove();
                    }
                    break;
                case 'undo_approve':
                    undoMove();
                    break;
                case 'restart':
                    if (confirm('对方请求重新开始，是否同意？')) {
                        resetGame();
                    }
                    break;
                case 'resign':
                    showModal(bluetoothSide, '对方认输');
                    break;
            }
        } catch (e) {
            console.error('解析蓝牙数据失败:', e, data);
        }
    },

    // 开始蓝牙对战
    startGame() {
        gameMode = 'bluetooth';
        showGameScreen();
        resetGame();
        // 主机执黑后手，客户端执红先手
        if (this.isHost) {
            bluetoothSide = 'black';
        } else {
            bluetoothSide = 'red';
        }
        updateModeLabel();
    },

    // 断开连接
    disconnect() {
        if (typeof window.bluetoothSerial !== 'undefined') {
            window.bluetoothSerial.disconnect(() => {},
                (err) => console.error('断开失败:', err));
        }
        this.connected = false;
        this.device = null;
        this.characteristic = null;
    }
};

// ============ Canvas 绘制 ============
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
canvas.width = BOARD_W;
canvas.height = BOARD_H;

function render() {
    drawBoard();
    drawHighlights();
    drawPieces();
    if (aiThinking) drawAIThinking();
}

function drawBoard() {
    const grad = ctx.createLinearGradient(0, 0, 0, BOARD_H);
    grad.addColorStop(0, '#f5d99a');
    grad.addColorStop(0.5, '#ecd088');
    grad.addColorStop(1, '#e8c478');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    ctx.strokeStyle = 'rgba(160, 110, 50, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        const y = Math.random() * BOARD_H;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(BOARD_W * 0.3, y + 4, BOARD_W * 0.7, y - 4, BOARD_W, y);
        ctx.stroke();
    }

    ctx.strokeStyle = '#6b4220';
    ctx.lineWidth = 1.5;

    for (let r = 0; r < 10; r++) {
        const y = OFFSET_Y + r * CELL;
        ctx.beginPath();
        ctx.moveTo(OFFSET_X, y);
        ctx.lineTo(OFFSET_X + 8 * CELL, y);
        ctx.stroke();
    }

    for (let c = 0; c < 9; c++) {
        const x = OFFSET_X + c * CELL;
        ctx.beginPath();
        if (c === 0 || c === 8) {
            ctx.moveTo(x, OFFSET_Y);
            ctx.lineTo(x, OFFSET_Y + 9 * CELL);
        } else {
            ctx.moveTo(x, OFFSET_Y);
            ctx.lineTo(x, OFFSET_Y + 4 * CELL);
            ctx.moveTo(x, OFFSET_Y + 5 * CELL);
            ctx.lineTo(x, OFFSET_Y + 9 * CELL);
        }
        ctx.stroke();
    }

    ctx.lineWidth = 1.5;
    drawDiagonal(3, 0, 5, 2);
    drawDiagonal(5, 0, 3, 2);
    drawDiagonal(3, 7, 5, 9);
    drawDiagonal(5, 7, 3, 9);

    ctx.fillStyle = '#6b4220';
    ctx.font = 'bold 26px "KaiTi", "STKaiti", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const riverY = OFFSET_Y + 4.5 * CELL;
    ctx.fillText('楚  河', OFFSET_X + 2 * CELL, riverY);
    ctx.fillText('漢  界', OFFSET_X + 6 * CELL, riverY);

    drawPositionMarks();
}

function drawDiagonal(c1, r1, c2, r2) {
    const p1 = posToPixel(r1, c1);
    const p2 = posToPixel(r2, c2);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
}

function drawPositionMarks() {
    const marks = [
        [2, 1], [2, 7], [7, 1], [7, 7],
        [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
        [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]
    ];
    marks.forEach(([r, c]) => drawCrossMark(r, c));
}

function drawCrossMark(row, col) {
    const { x, y } = posToPixel(row, col);
    const size = 5, gap = 4;
    ctx.strokeStyle = '#6b4220';
    ctx.lineWidth = 1.2;
    const corners = [
        { dx: -1, dy: -1, draw: col > 0 },
        { dx:  1, dy: -1, draw: col < 8 },
        { dx: -1, dy:  1, draw: col > 0 },
        { dx:  1, dy:  1, draw: col < 8 }
    ];
    corners.forEach(({ dx, dy, draw }) => {
        if (!draw) return;
        const cx = x + dx * gap;
        const cy = y + dy * gap;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * size, cy);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy + dy * size);
        ctx.stroke();
    });
}

function drawHighlights() {
    if (selected) {
        const { x, y } = posToPixel(selected.row, selected.col);
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 3;
        const s = 24;
        drawCorner(x - s, y - s, x + s, y + s, 8);
    }
    validMoves.forEach(m => {
        const { x, y } = posToPixel(m.row, m.col);
        const target = board[m.row][m.col];
        if (target) {
            ctx.strokeStyle = 'rgba(231, 76, 60, 0.8)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x, y, 25, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.fillStyle = 'rgba(39, 174, 96, 0.7)';
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

function drawCorner(x1, y1, x2, y2, len) {
    ctx.beginPath();
    ctx.moveTo(x1, y1 + len); ctx.lineTo(x1, y1); ctx.lineTo(x1 + len, y1);
    ctx.moveTo(x2 - len, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + len);
    ctx.moveTo(x1, y2 - len); ctx.lineTo(x1, y2); ctx.lineTo(x1 + len, y2);
    ctx.moveTo(x2 - len, y2); ctx.lineTo(x2, y2); ctx.lineTo(x2, y2 - len);
    ctx.stroke();
}

function drawAIThinking() {
    // 半透明背景条
    const barH = 56;
    const barY = BOARD_H / 2 - barH / 2;
    ctx.fillStyle = 'rgba(20, 20, 30, 0.82)';
    ctx.fillRect(0, barY, BOARD_W, barH);

    // 左侧跳动圆点
    const t = (performance.now() / 200) % 3;
    for (let i = 0; i < 3; i++) {
        const cx = BOARD_W / 2 - 70 + i * 16;
        const bounce = t > i && t < i + 1 ? Math.sin((t - i) * Math.PI) * 6 : 0;
        ctx.beginPath();
        ctx.arc(cx, BOARD_H / 2 + bounce, 5, 0, Math.PI * 2);
        ctx.fillStyle = i === Math.floor(t) ? '#f0c040' : 'rgba(240,192,64,0.4)';
        ctx.fill();
    }

    // 文字
    ctx.fillStyle = '#f0c040';
    ctx.font = 'bold 20px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('AI 思考中', BOARD_W / 2 - 20, BOARD_H / 2);
}

function drawPieces() {
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = board[r][c];
            if (!p) continue;
            // 动画中：跳过起点位置的棋子（它会画在动画路径上）
            if (animating && animState && r === animState.fromR && c === animState.fromC) continue;
            drawPiece(r, c, p);
        }
    }
    // 绘制动画中的棋子
    if (animating && animState) {
        const { piece, fromR, fromC, toR, toC, progress } = animState;
        const from = posToPixel(fromR, fromC);
        const to = posToPixel(toR, toC);
        const x = from.x + (to.x - from.x) * progress;
        const y = from.y + (to.y - from.y) * progress;
        drawPieceAt(piece, x, y, 1 + 0.08 * Math.sin(progress * Math.PI));
    }
}

function drawPiece(row, col, piece) {
    const { x, y } = posToPixel(row, col);
    drawPieceAt(piece, x, y, 1);
}

function drawPieceAt(piece, x, y, scale) {
    const radius = 24 * scale;
    const isRed = piece.side === 'red';

    ctx.beginPath();
    ctx.arc(x + 2, y + 3, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();

    const bg = ctx.createRadialGradient(x - 6, y - 6, 2, x, y, radius);
    bg.addColorStop(0, '#fff5e0');
    bg.addColorStop(0.7, '#f0ddb0');
    bg.addColorStop(1, '#d8b878');
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();

    ctx.strokeStyle = isRed ? '#c0392b' : '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, radius - 4, 0, Math.PI * 2);
    ctx.strokeStyle = isRed ? 'rgba(192,57,43,0.4)' : 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = isRed ? '#c0392b' : '#1a1a1a';
    ctx.font = `bold ${Math.round(26 * scale)}px "KaiTi", "STKaiti", "SimSun", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(PIECE_CHAR[piece.side][piece.type], x, y + 1);
}

// ============ 交互 ============

// 判断当前是否轮到本地玩家
function isLocalTurn() {
    if (gameMode === 'pvp') return true;
    if (gameMode === 'pve') return currentSide !== aiSide;
    if (gameMode === 'bluetooth') return currentSide === bluetoothSide;
    return true;
}

// 统一处理点击/触摸
function handlePointer(clientX, clientY) {
    if (aiThinking) return;
    if (animating) return;
    if (gameMode === 'pve' && currentSide === aiSide) return;
    if (gameMode === 'bluetooth' && currentSide !== bluetoothSide) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const pos = pixelToPos(x, y);
    if (!pos) return;
    handleClick(pos.row, pos.col);
}

canvas.addEventListener('click', (e) => {
    handlePointer(e.clientX, e.clientY);
});

// 触摸支持（移动端）
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length > 0) {
        handlePointer(e.touches[0].clientX, e.touches[0].clientY);
    }
}, { passive: false });

function handleClick(row, col) {
    const piece = board[row][col];

    if (selected) {
        if (piece && piece.side === currentSide) {
            selected = { row, col };
            validMoves = getLegalMoves(board, row, col);
            render();
            return;
        }
        const move = validMoves.find(m => m.row === row && m.col === col);
        if (move) {
            makeMove(selected.row, selected.col, row, col);
            return;
        }
        selected = null;
        validMoves = [];
        render();
        return;
    }

    if (piece && piece.side === currentSide) {
        selected = { row, col };
        validMoves = getLegalMoves(board, row, col);
        render();
    }
}

function makeMove(fromR, fromC, toR, toC, fromBluetooth) {
    if (animating) return;  // 动画中忽略
    const piece = board[fromR][fromC];
    if (!piece) return;
    const target = board[toR][toC];
    const isCapture = !!target;

    selected = null;
    validMoves = [];
    render();

    // 蓝牙对战：立即发送走棋数据给对方
    if (gameMode === 'bluetooth' && !fromBluetooth && BluetoothManager.connected) {
        BluetoothManager.send({
            type: 'move',
            from: { row: fromR, col: fromC },
            to: { row: toR, col: toC }
        });
    }

    // 启动移动动画，动画结束后更新棋盘状态
    startMoveAnim(piece, fromR, fromC, toR, toC, target, () => {
        history.push({
            from: { row: fromR, col: fromC },
            to: { row: toR, col: toC },
            piece: { ...piece },
            captured: target ? { ...target } : null,
            side: currentSide
        });

        board[toR][toC] = piece;
        board[fromR][fromC] = null;
        if (target) captured[target.side].push(target);

        addMoveLog(piece, fromR, fromC, toR, toC, isCapture);

        // 语音播报走棋
        speakMove(piece, fromR, fromC, toR, toC, isCapture);

        currentSide = currentSide === 'red' ? 'black' : 'red';

        updateUI();
        render();

        const gameOver = checkGameOver();

        // AI 回合
        if (!gameOver && gameMode === 'pve' && currentSide === aiSide) {
            scheduleAI();
        }
    });
}

function checkGameOver() {
    const inCheck = isInCheck(board, currentSide);
    const hasMove = hasAnyLegalMove(board, currentSide);

    if (!hasMove) {
        const winner = currentSide === 'red' ? 'black' : 'red';
        const reason = inCheck ? '将死' : '困毙';
        // 语音播报游戏结束
        if (gameMode === 'pve') {
            const playerSide = aiSide === 'red' ? 'black' : 'red';
            const playerWin = winner === playerSide;
            speak(playerWin ? '恭喜你赢了' : 'AI获胜，再接再厉');
        } else {
            const winnerName = winner === 'red' ? '红方' : '黑方';
            speak(`${winnerName} ${reason}，游戏结束`);
        }
        showModal(winner, reason);
        return true;
    } else if (inCheck) {
        const statusEl = document.getElementById(currentSide + 'Status');
        statusEl.textContent = '被将军！';
        statusEl.style.color = '#ff4444';
        speak('将军');
    }
    return false;
}

// ============ 棋谱记录 ============
function addMoveLog(piece, fromR, fromC, toR, toC, isCapture) {
    const log = document.getElementById('moveLog');
    const li = document.createElement('li');
    li.className = piece.side + '-move';
    const char = PIECE_CHAR[piece.side][piece.type];
    const fromCol = piece.side === 'red' ? (9 - fromC) : (fromC + 1);
    const toCol = piece.side === 'red' ? (9 - toC) : (toC + 1);
    let action;
    if (fromR === toR) {
        action = `平${toCol}`;
    } else {
        const forward = piece.side === 'red' ? fromR > toR : fromR < toR;
        const steps = Math.abs(fromR - toR);
        const stepStr = piece.side === 'red'
            ? ['一','二','三','四','五','六','七','八','九'][steps - 1]
            : steps;
        action = forward ? `进${isCapture || piece.type === 'horse' || piece.type === 'elephant' || piece.type === 'advisor' || piece.type === 'king' ? toCol : stepStr}` : `退${isCapture || piece.type === 'horse' || piece.type === 'elephant' || piece.type === 'advisor' || piece.type === 'king' ? toCol : stepStr}`;
    }
    li.textContent = `${char}${fromCol}${action}`;
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
}

// ============ UI 更新 ============
function updateUI() {
    document.getElementById('redCard').classList.toggle('active', currentSide === 'red');
    document.getElementById('blackCard').classList.toggle('active', currentSide === 'black');

    const redStatus = document.getElementById('redStatus');
    const blackStatus = document.getElementById('blackStatus');
    redStatus.style.color = '';
    blackStatus.style.color = '';

    if (gameMode === 'pve') {
        if (currentSide === aiSide) {
            redStatus.textContent = aiSide === 'red' ? (aiThinking ? 'AI思考中...' : 'AI') : '等待';
            blackStatus.textContent = aiSide === 'black' ? (aiThinking ? 'AI思考中...' : 'AI') : '等待';
        } else {
            redStatus.textContent = aiSide === 'red' ? 'AI' : '行棋中';
            blackStatus.textContent = aiSide === 'black' ? 'AI' : '行棋中';
        }
    } else if (gameMode === 'bluetooth') {
        redStatus.textContent = currentSide === 'red' ? '行棋中' : '等待';
        blackStatus.textContent = currentSide === 'black' ? '行棋中' : '等待';
    } else {
        redStatus.textContent = currentSide === 'red' ? '行棋中' : '等待';
        blackStatus.textContent = currentSide === 'black' ? '行棋中' : '等待';
    }

    renderCaptured('blackCaptured', captured.black);
    renderCaptured('redCaptured', captured.red);
}

function renderCaptured(elementId, list) {
    const el = document.getElementById(elementId);
    el.innerHTML = '';
    list.forEach(p => {
        const span = document.createElement('span');
        span.className = 'mini-piece ' + p.side;
        span.textContent = PIECE_CHAR[p.side][p.type];
        el.appendChild(span);
    });
}

function updateModeLabel() {
    const label = document.getElementById('modeLabel');
    if (gameMode === 'pvp') {
        label.textContent = '双人对战 · 楚河汉界';
    } else if (gameMode === 'pve') {
        const diffName = aiDepth === 1 ? '简单' : aiDepth === 3 ? '中等' : '困难';
        label.textContent = `人机对战 · ${diffName} · AI执${aiSide === 'red' ? '红' : '黑'}`;
    } else if (gameMode === 'bluetooth') {
        label.textContent = `蓝牙对战 · 你执${bluetoothSide === 'red' ? '红' : '黑'}`;
    }
}

// ============ 弹窗 ============
function showModal(winner, reason) {
    const modal = document.getElementById('modal');
    const title = document.getElementById('modalTitle');
    const text = document.getElementById('modalText');
    const winnerName = winner === 'red' ? '红方' : '黑方';

    if (gameMode === 'pve') {
        const playerSide = aiSide === 'red' ? 'black' : 'red';
        const playerWin = winner === playerSide;
        title.textContent = playerWin ? '你赢了！' : 'AI 获胜';
    } else if (gameMode === 'bluetooth') {
        const localWin = winner === bluetoothSide;
        title.textContent = localWin ? '你赢了！' : '对方获胜';
    } else {
        title.textContent = winnerName + ' 胜！';
    }

    text.textContent = `${reason} · 棋局结束`;
    modal.classList.add('show');
}

document.getElementById('modalBtn').addEventListener('click', () => {
    document.getElementById('modal').classList.remove('show');
    document.getElementById('moveLog').innerHTML = '';
    resetGame();
});

// ============ 悔棋 ============
function undoMove() {
    if (history.length === 0) return;

    // 人机模式：悔两步（己方+AI）
    const stepsToUndo = (gameMode === 'pve') ? Math.min(2, history.length) : 1;

    for (let i = 0; i < stepsToUndo; i++) {
        if (history.length === 0) break;
        const last = history.pop();
        board[last.from.row][last.from.col] = last.piece;
        board[last.to.row][last.to.col] = last.captured;
        if (last.captured) {
            const arr = captured[last.captured.side];
            arr.pop();
        }
        currentSide = last.side;

        const log = document.getElementById('moveLog');
        if (log.lastChild) log.removeChild(log.lastChild);
    }

    selected = null;
    validMoves = [];
    aiThinking = false;
    document.getElementById('modal').classList.remove('show');
    updateUI();
    render();
}

// ============ 控制按钮 ============
document.getElementById('restartBtn').addEventListener('click', () => {
    document.getElementById('moveLog').innerHTML = '';
    if (gameMode === 'bluetooth' && BluetoothManager.connected) {
        BluetoothManager.send({ type: 'restart' });
    }
    resetGame();
});

document.getElementById('undoBtn').addEventListener('click', () => {
    if (gameMode === 'bluetooth' && BluetoothManager.connected) {
        BluetoothManager.send({ type: 'undo_request' });
        return;
    }
    undoMove();
});

document.getElementById('flipBtn').addEventListener('click', () => {
    flipped = !flipped;
    render();
});

document.getElementById('soundBtn').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('soundBtn');
    btn.textContent = soundEnabled ? '🔊 语音开' : '🔇 语音关';
    if (!soundEnabled && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
});

document.getElementById('backToMenu').addEventListener('click', () => {
    if (gameMode === 'bluetooth' && BluetoothManager.connected) {
        BluetoothManager.disconnect();
    }
    showMenuScreen();
});

// ============ 模式选择 ============
function showMenuScreen() {
    document.getElementById('menuScreen').classList.remove('hidden');
    document.getElementById('difficultyScreen').classList.add('hidden');
    document.getElementById('bluetoothScreen').classList.add('hidden');
    document.getElementById('gameApp').classList.add('hidden');
}

function showGameScreen() {
    document.getElementById('menuScreen').classList.add('hidden');
    document.getElementById('difficultyScreen').classList.add('hidden');
    document.getElementById('bluetoothScreen').classList.add('hidden');
    document.getElementById('gameApp').classList.remove('hidden');
}

function showDifficultyScreen() {
    document.getElementById('menuScreen').classList.add('hidden');
    document.getElementById('difficultyScreen').classList.remove('hidden');
}

function showBluetoothScreen() {
    document.getElementById('menuScreen').classList.add('hidden');
    document.getElementById('bluetoothScreen').classList.remove('hidden');
    document.getElementById('btStatus').textContent = '';
    document.getElementById('btStatus').className = 'bt-status';
    document.getElementById('btDeviceList').innerHTML = '';
}

// 双人对战
document.getElementById('modePvp').addEventListener('click', () => {
    gameMode = 'pvp';
    showGameScreen();
    resetGame();
    updateModeLabel();
});

// 人机对战 → 选择难度
document.getElementById('modePve').addEventListener('click', () => {
    showDifficultyScreen();
});

// 难度选择
document.querySelectorAll('[data-difficulty]').forEach(btn => {
    btn.addEventListener('click', () => {
        aiDepth = parseInt(btn.dataset.difficulty);
        gameMode = 'pve';
        aiSide = 'black'; // AI 执黑后手
        showGameScreen();
        resetGame();
        updateModeLabel();
    });
});

document.getElementById('backFromDifficulty').addEventListener('click', showMenuScreen);
document.getElementById('backFromBluetooth').addEventListener('click', showMenuScreen);

// 蓝牙对战
document.getElementById('modeBluetooth').addEventListener('click', () => {
    if (!BluetoothManager.isSupported()) {
        alert('当前环境不支持蓝牙对战。\n请下载安装安卓 APK 版本使用蓝牙功能。');
        return;
    }
    showBluetoothScreen();
});

document.getElementById('btHost').addEventListener('click', () => {
    BluetoothManager.host();
});

document.getElementById('btJoin').addEventListener('click', () => {
    BluetoothManager.join();
});

// ============ 启动 ============
initSpeech();
showMenuScreen();
