/*
 * 中国象棋 · 游戏引擎
 * 棋盘坐标：board[row][col]，row 0-9（上到下），col 0-8（左到右）
 * 黑方在上（row 0-4），红方在下（row 5-9）
 */

// ============ 棋子定义 ============
const PIECE_CHAR = {
    red:   { king: '帥', advisor: '仕', elephant: '相', horse: '馬', chariot: '車', cannon: '炮', pawn: '兵' },
    black: { king: '將', advisor: '士', elephant: '象', horse: '馬', chariot: '車', cannon: '砲', pawn: '卒' }
};

// 初始局面
function createInitialBoard() {
    const b = Array.from({ length: 10 }, () => Array(9).fill(null));
    // 黑方（上方）
    const blackBack = ['chariot','horse','elephant','advisor','king','advisor','elephant','horse','chariot'];
    blackBack.forEach((t, c) => b[0][c] = { type: t, side: 'black' });
    b[2][1] = { type: 'cannon', side: 'black' };
    b[2][7] = { type: 'cannon', side: 'black' };
    [0,2,4,6,8].forEach(c => b[3][c] = { type: 'pawn', side: 'black' });
    // 红方（下方）
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

function resetGame() {
    board = createInitialBoard();
    currentSide = 'red';
    selected = null;
    validMoves = [];
    history = [];
    captured = { red: [], black: [] };
    updateUI();
    render();
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

// 获取一个棋子的原始可走点（不考虑将军限制）
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
            // 帅/将：九宫内一步直行
            [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc]) => {
                const nr = row + dr, nc = col + dc;
                if (inPalace(nr, nc, side)) tryAdd(nr, nc);
            });
            break;
        }
        case 'advisor': {
            // 仕/士：九宫内一步斜行
            [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr,dc]) => {
                const nr = row + dr, nc = col + dc;
                if (inPalace(nr, nc, side)) tryAdd(nr, nc);
            });
            break;
        }
        case 'elephant': {
            // 相/象：田字两步斜行，不过河，不塞象眼
            [[-2,-2],[-2,2],[2,-2],[2,2]].forEach(([dr,dc]) => {
                const nr = row + dr, nc = col + dc;
                if (!inBoard(nr, nc)) return;
                // 不过河
                if (side === 'red' && nr < 5) return;
                if (side === 'black' && nr > 4) return;
                // 塞象眼
                const mr = row + dr/2, mc = col + dc/2;
                if (b[mr][mc]) return;
                tryAdd(nr, nc);
            });
            break;
        }
        case 'horse': {
            // 马：日字，蹩马腿
            const horseMoves = [
                [-2,-1,-1,0],[-2,1,-1,0],   // 上
                [2,-1,1,0],[2,1,1,0],       // 下
                [-1,-2,0,-1],[1,-2,0,-1],   // 左
                [-1,2,0,1],[1,2,0,1]        // 右
            ];
            horseMoves.forEach(([dr,dc,br,bc]) => {
                const nr = row + dr, nc = col + dc;
                if (!inBoard(nr, nc)) return;
                if (b[row + br][col + bc]) return; // 蹩马腿
                tryAdd(nr, nc);
            });
            break;
        }
        case 'chariot': {
            // 车：直线任意步，不跳
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
            // 炮：移动如车，吃子需隔一子（炮架）
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
            // 兵/卒
            const forward = side === 'red' ? -1 : 1;
            tryAdd(row + forward, col); // 向前
            if (crossedRiver(row, side)) {
                tryAdd(row, col - 1);   // 过河可横走
                tryAdd(row, col + 1);
            }
            break;
        }
    }
    return moves;
}

// 找帅/将位置
function findKing(b, side) {
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = b[r][c];
            if (p && p.type === 'king' && p.side === side) return { row: r, col: c };
        }
    }
    return null;
}

// 判断 side 方是否被将军
function isInCheck(b, side) {
    const king = findKing(b, side);
    if (!king) return true;
    const enemy = side === 'red' ? 'black' : 'red';

    // 检查所有敌方棋子能否吃到将
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = b[r][c];
            if (p && p.side === enemy) {
                const moves = getRawMoves(b, r, c);
                if (moves.some(m => m.row === king.row && m.col === king.col)) return true;
            }
        }
    }

    // 飞将规则：两将同列且中间无子
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

// 获取合法走法（排除走完后己方被将军的走法）
function getLegalMoves(b, row, col) {
    const piece = b[row][col];
    if (!piece) return [];
    const raw = getRawMoves(b, row, col);
    return raw.filter(m => {
        // 模拟走子
        const saved = b[m.row][m.col];
        b[m.row][m.col] = piece;
        b[row][col] = null;
        const ok = !isInCheck(b, piece.side);
        // 还原
        b[row][col] = piece;
        b[m.row][m.col] = saved;
        return ok;
    });
}

// 判断 side 方是否还有合法走法
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

// ============ Canvas 绘制 ============
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
canvas.width = BOARD_W;
canvas.height = BOARD_H;

function render() {
    drawBoard();
    drawHighlights();
    drawPieces();
}

function drawBoard() {
    // 木纹底色
    const grad = ctx.createLinearGradient(0, 0, 0, BOARD_H);
    grad.addColorStop(0, '#f5d99a');
    grad.addColorStop(0.5, '#ecd088');
    grad.addColorStop(1, '#e8c478');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    // 木纹纹理（细线）
    ctx.strokeStyle = 'rgba(160, 110, 50, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        const y = Math.random() * BOARD_H;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(BOARD_W * 0.3, y + 4, BOARD_W * 0.7, y - 4, BOARD_W, y);
        ctx.stroke();
    }

    // 棋盘线
    ctx.strokeStyle = '#6b4220';
    ctx.lineWidth = 1.5;

    // 横线 10 条
    for (let r = 0; r < 10; r++) {
        const y = OFFSET_Y + r * CELL;
        ctx.beginPath();
        ctx.moveTo(OFFSET_X, y);
        ctx.lineTo(OFFSET_X + 8 * CELL, y);
        ctx.stroke();
    }

    // 竖线 9 条（中间在楚河汉界处断开）
    for (let c = 0; c < 9; c++) {
        const x = OFFSET_X + c * CELL;
        ctx.beginPath();
        if (c === 0 || c === 8) {
            // 边线贯通
            ctx.moveTo(x, OFFSET_Y);
            ctx.lineTo(x, OFFSET_Y + 9 * CELL);
        } else {
            // 上半
            ctx.moveTo(x, OFFSET_Y);
            ctx.lineTo(x, OFFSET_Y + 4 * CELL);
            // 下半
            ctx.moveTo(x, OFFSET_Y + 5 * CELL);
            ctx.lineTo(x, OFFSET_Y + 9 * CELL);
        }
        ctx.stroke();
    }

    // 九宫斜线
    ctx.lineWidth = 1.5;
    // 黑方九宫
    drawDiagonal(3, 0, 5, 2);
    drawDiagonal(5, 0, 3, 2);
    // 红方九宫
    drawDiagonal(3, 7, 5, 9);
    drawDiagonal(5, 7, 3, 9);

    // 楚河汉界文字
    ctx.fillStyle = '#6b4220';
    ctx.font = 'bold 26px "KaiTi", "STKaiti", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const riverY = OFFSET_Y + 4.5 * CELL;
    ctx.fillText('楚  河', OFFSET_X + 2 * CELL, riverY);
    ctx.fillText('漢  界', OFFSET_X + 6 * CELL, riverY);

    // 兵卒炮位置标记
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

// 画兵线位置的小十字标记
function drawPositionMarks() {
    const marks = [
        // 黑炮位
        [2, 1], [2, 7],
        // 红炮位
        [7, 1], [7, 7],
        // 黑卒位
        [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
        // 红兵位
        [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]
    ];
    marks.forEach(([r, c]) => drawCrossMark(r, c));
}

function drawCrossMark(row, col) {
    const { x, y } = posToPixel(row, col);
    const size = 5, gap = 4;
    ctx.strokeStyle = '#6b4220';
    ctx.lineWidth = 1.2;
    // 四个角的小折角（边上的只画内侧）
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
        // 选中框
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 3;
        const s = 24;
        drawCorner(x - s, y - s, x + s, y + s, 8);
    }
    validMoves.forEach(m => {
        const { x, y } = posToPixel(m.row, m.col);
        const target = board[m.row][m.col];
        if (target) {
            // 可吃子：红圈
            ctx.strokeStyle = 'rgba(231, 76, 60, 0.8)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x, y, 25, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            // 可走点：小圆点
            ctx.fillStyle = 'rgba(39, 174, 96, 0.7)';
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

function drawCorner(x1, y1, x2, y2, len) {
    ctx.beginPath();
    // 左上
    ctx.moveTo(x1, y1 + len); ctx.lineTo(x1, y1); ctx.lineTo(x1 + len, y1);
    // 右上
    ctx.moveTo(x2 - len, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + len);
    // 左下
    ctx.moveTo(x1, y2 - len); ctx.lineTo(x1, y2); ctx.lineTo(x1 + len, y2);
    // 右下
    ctx.moveTo(x2 - len, y2); ctx.lineTo(x2, y2); ctx.lineTo(x2, y2 - len);
    ctx.stroke();
}

function drawPieces() {
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = board[r][c];
            if (p) drawPiece(r, c, p);
        }
    }
}

function drawPiece(row, col, piece) {
    const { x, y } = posToPixel(row, col);
    const radius = 24;
    const isRed = piece.side === 'red';

    // 阴影
    ctx.beginPath();
    ctx.arc(x + 2, y + 3, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();

    // 棋子底色（象牙色渐变）
    const bg = ctx.createRadialGradient(x - 6, y - 6, 2, x, y, radius);
    bg.addColorStop(0, '#fff5e0');
    bg.addColorStop(0.7, '#f0ddb0');
    bg.addColorStop(1, '#d8b878');
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();

    // 外圈
    ctx.strokeStyle = isRed ? '#c0392b' : '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 内圈细线
    ctx.beginPath();
    ctx.arc(x, y, radius - 4, 0, Math.PI * 2);
    ctx.strokeStyle = isRed ? 'rgba(192,57,43,0.4)' : 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 文字
    ctx.fillStyle = isRed ? '#c0392b' : '#1a1a1a';
    ctx.font = 'bold 26px "KaiTi", "STKaiti", "SimSun", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(PIECE_CHAR[piece.side][piece.type], x, y + 1);
}

// ============ 交互 ============
canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const pos = pixelToPos(x, y);
    if (!pos) return;
    handleClick(pos.row, pos.col);
});

function handleClick(row, col) {
    const piece = board[row][col];

    if (selected) {
        // 点击自己的棋子 → 切换选中
        if (piece && piece.side === currentSide) {
            selected = { row, col };
            validMoves = getLegalMoves(board, row, col);
            render();
            return;
        }
        // 点击合法走点 → 走子
        const move = validMoves.find(m => m.row === row && m.col === col);
        if (move) {
            makeMove(selected.row, selected.col, row, col);
            return;
        }
        // 点击空地或敌方棋子（非合法走点）→ 取消选中
        selected = null;
        validMoves = [];
        render();
        return;
    }

    // 未选中 → 选中己方棋子
    if (piece && piece.side === currentSide) {
        selected = { row, col };
        validMoves = getLegalMoves(board, row, col);
        render();
    }
}

function makeMove(fromR, fromC, toR, toC) {
    const piece = board[fromR][fromC];
    const target = board[toR][toC];
    const isCapture = !!target;

    // 记录历史（用于悔棋）
    history.push({
        from: { row: fromR, col: fromC },
        to: { row: toR, col: toC },
        piece: { ...piece },
        captured: target ? { ...target } : null,
        side: currentSide
    });

    // 执行走子
    board[toR][toC] = piece;
    board[fromR][fromC] = null;

    // 记录被吃棋子
    if (target) captured[target.side].push(target);

    // 记录棋谱
    addMoveLog(piece, fromR, fromC, toR, toC, isCapture);

    selected = null;
    validMoves = [];

    // 切换回合
    currentSide = currentSide === 'red' ? 'black' : 'red';

    updateUI();
    render();

    // 判断胜负
    checkGameOver();
}

function checkGameOver() {
    const inCheck = isInCheck(board, currentSide);
    const hasMove = hasAnyLegalMove(board, currentSide);

    if (!hasMove) {
        const winner = currentSide === 'red' ? 'black' : 'red';
        const reason = inCheck ? '将死' : '困毙';
        showModal(winner, reason);
    } else if (inCheck) {
        // 将军提示
        const statusEl = document.getElementById(currentSide + 'Status');
        statusEl.textContent = '被将军！';
        statusEl.style.color = '#ff4444';
    }
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
    redStatus.textContent = currentSide === 'red' ? '行棋中' : '等待';
    blackStatus.textContent = currentSide === 'black' ? '行棋中' : '等待';

    // 俘获棋子
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

// ============ 弹窗 ============
function showModal(winner, reason) {
    const modal = document.getElementById('modal');
    const title = document.getElementById('modalTitle');
    const text = document.getElementById('modalText');
    const winnerName = winner === 'red' ? '红方' : '黑方';
    title.textContent = winnerName + ' 胜！';
    text.textContent = `${reason} · 棋局结束`;
    modal.classList.add('show');
}

document.getElementById('modalBtn').addEventListener('click', () => {
    document.getElementById('modal').classList.remove('show');
    document.getElementById('moveLog').innerHTML = '';
    resetGame();
});

// ============ 控制按钮 ============
document.getElementById('restartBtn').addEventListener('click', () => {
    document.getElementById('moveLog').innerHTML = '';
    resetGame();
});

document.getElementById('undoBtn').addEventListener('click', () => {
    if (history.length === 0) return;
    const last = history.pop();
    // 还原棋子
    board[last.from.row][last.from.col] = last.piece;
    board[last.to.row][last.to.col] = last.captured;
    // 还原俘获
    if (last.captured) {
        const arr = captured[last.captured.side];
        arr.pop();
    }
    // 切回上一方
    currentSide = last.side;
    selected = null;
    validMoves = [];

    // 移除棋谱最后一条
    const log = document.getElementById('moveLog');
    if (log.lastChild) log.removeChild(log.lastChild);

    // 关闭可能存在的将军提示
    document.getElementById('modal').classList.remove('show');

    updateUI();
    render();
});

document.getElementById('flipBtn').addEventListener('click', () => {
    flipped = !flipped;
    render();
});

// ============ 启动 ============
resetGame();
