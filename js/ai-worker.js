// ============================================================
// AI 计算 Worker —— 在独立线程运行 Minimax + Alpha-Beta 搜索
// 避免阻塞主线程导致卡顿 / ANR 闪退
// 自包含所有走法生成与评估逻辑，不依赖外部文件
// ============================================================

function inBoard(r, c) { return r >= 0 && r <= 9 && c >= 0 && c <= 8; }

function inPalace(row, col, side) {
    if (col < 3 || col > 5) return false;
    if (side === 'red') return row >= 7 && row <= 9;
    return row >= 0 && row <= 2;
}

function crossedRiver(row, side) {
    return side === 'red' ? row <= 4 : row >= 5;
}

// 生成某个棋子的原始走法（不考虑将军）
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

const PIECE_VALUE = {
    king: 10000, chariot: 900, horse: 400, cannon: 450,
    elephant: 200, advisor: 200, pawn: 100
};

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

function getPosValue(piece, row, col) {
    const table = POS_VALUE[piece.type];
    if (!table) return 0;
    if (piece.side === 'red') return table[row][col];
    return table[9 - row][8 - col];
}

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

    return candidates[Math.floor(Math.random() * candidates.length)] || bestMove;
}

// 接收主线程的计算请求
onmessage = function(e) {
    const { board, side, depth, taskId } = e.data;
    try {
        const move = findBestMove(board, side, depth);
        postMessage({ move: move, taskId: taskId, error: null });
    } catch (err) {
        postMessage({ move: null, taskId: taskId, error: String(err) });
    }
};
