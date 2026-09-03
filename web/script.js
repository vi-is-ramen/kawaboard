const canvas = document.getElementById('sketchpad');
const ctx = canvas.getContext('2d');
const boardPanel = document.querySelector('.board-panel');
const toolbar = document.querySelector('.toolbar');
const expandBtn = document.getElementById('expand-canvas');
const clearBtn = document.getElementById('clear-board');
const undoBtn = document.getElementById('undo-board');
const editor = document.getElementById('text-editor');
const newBtn = document.getElementById('new-board');
const openBtn = document.getElementById('open-board');
const saveBtn = document.getElementById('save-board');
const penSizeInput = document.getElementById('pen-size');

const EXPAND_STEP = 400;
const MAX_UNDO = 30;

let objects = [];
let selection = [];
let marquee = null;
let drag = null;
let drawing = false;
let currentStroke = null;
let eraseChanged = false;
let lastX = 0, lastY = 0;

let penColor = '#FFB6C1';
let penSize = 3;
let currentTool = 'brush';

let baseHeight = 600;
let extraHeight = 0;
let undoStack = [];
let currentName = null;

let pressureSmooth = 0.5;
function pressureFactor(e) {
    if (e.pointerType === 'pen' && typeof e.pressure === 'number') {
        pressureSmooth += (e.pressure - pressureSmooth) * 0.35;
        return 0.25 + 1.5 * pressureSmooth;
    }
    return 1;
}
function getCoalesced(e) {
    if (typeof e.getCoalescedEvents === 'function') {
        const evs = e.getCoalescedEvents();
        if (evs && evs.length) return evs;
    }
    return [e];
}

boardPanel.style.display = 'block';
boardPanel.style.overflowY = 'auto';
canvas.style.display = 'block';
canvas.style.width = '100%';
canvas.style.flex = 'none';
const wrap = canvas.parentElement;
if (wrap && wrap !== boardPanel) {
    wrap.style.display = 'block';
    wrap.style.position = 'relative';
}

function constrainPanel() {
    boardPanel.style.height = '';
    boardPanel.style.maxHeight = '';
    const bTop = boardPanel.getBoundingClientRect().top;
    const kTop = document.querySelector('.blocks-panel').getBoundingClientRect().top;
    const stacked = Math.abs(kTop - bTop) > 40;
    const h = stacked ? Math.floor(window.innerHeight / 2) : window.innerHeight;
    boardPanel.style.height = h + 'px';
    boardPanel.style.maxHeight = h + 'px';
}
function computeBaseHeight() {
    const panelH = boardPanel.clientHeight;
    const tbH = toolbar ? toolbar.offsetHeight : 0;
    const ebH = expandBtn ? expandBtn.offsetHeight : 0;
    baseHeight = Math.max(320, panelH - tbH - ebH - 90);
}
function targetWidth() {
    return Math.max(200, boardPanel.clientWidth - 24);
}
function applyHeight() {
    canvas.height = baseHeight + extraHeight;
    canvas.style.height = canvas.height + 'px';
}
function resizeCanvas() {
    computeBaseHeight();
    canvas.width = targetWidth();
    if (!canvas.dataset.initialized) {
        applyHeight();
        canvas.dataset.initialized = 'true';
    }
    redraw();
}
boardPanel.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return;
    e.preventDefault();
    const step = e.deltaMode === 1 ? e.deltaY * 16 : (e.deltaMode === 2 ? e.deltaY * 120 : e.deltaY);
    boardPanel.scrollTop += step;
}, { passive: false });

function setFont(size) { ctx.font = `600 ${size}px Nunito, sans-serif`; }
function strokeMaxWidth(o) {
    let maxW = o.size || 3;
    for (const p of o.points) if (p.w) maxW = Math.max(maxW, p.w);
    return maxW;
}
function drawObj(o) {
    if (o.type === 'stroke') {
        const pts = o.points;
        ctx.strokeStyle = o.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (pts.length === 1) {
            const w = pts[0].w || o.size || 3;
            ctx.beginPath();
            ctx.arc(pts[0].x, pts[0].y, w / 2, 0, 2 * Math.PI);
            ctx.fillStyle = o.color;
            ctx.fill();
            return;
        }
        for (let i = 1; i < pts.length; i++) {
            const w0 = pts[i - 1].w || o.size || 3;
            const w1 = pts[i].w || o.size || 3;
            ctx.lineWidth = (w0 + w1) / 2;
            ctx.beginPath();
            ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
            ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
        }
    } else {
        setFont(o.size);
        ctx.fillStyle = o.color;
        ctx.textBaseline = 'top';
        ctx.fillText(o.text, o.x, o.y);
    }
}
function normRect(r) {
    const x = Math.min(r.x0, r.x1), y = Math.min(r.y0, r.y1);
    return { x, y, w: Math.abs(r.x1 - r.x0), h: Math.abs(r.y1 - r.y0) };
}
function drawDashed(r) {
    ctx.save();
    ctx.strokeStyle = '#d48ab0';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
}
function bboxOf(o) {
    if (o.type === 'stroke') {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of o.points) {
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        }
        const r = strokeMaxWidth(o) / 2;
        return { x: minX - r, y: minY - r, w: maxX - minX + r * 2, h: maxY - minY + r * 2 };
    }
    setFont(o.size);
    return { x: o.x, y: o.y, w: ctx.measureText(o.text).width, h: o.size * 1.2 };
}
function unionBBox(list) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of list) {
        const b = bboxOf(o);
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    return { x: minX - 4, y: minY - 4, w: maxX - minX + 8, h: maxY - minY + 8 };
}
function intersects(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const o of objects) drawObj(o);
    if (marquee) drawDashed(normRect(marquee));
    else if (selection.length) drawDashed(unionBBox(selection));
}

function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function hitTest(p) {
    for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        if (o.type === 'text') {
            const b = bboxOf(o);
            if (p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 4 && p.y <= b.y + b.h + 4) return o;
        } else {
            const tol = strokeMaxWidth(o) / 2 + 5;
            const pts = o.points;
            if (pts.length === 1 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tol) return o;
            for (let j = 1; j < pts.length; j++) {
                if (distToSeg(p, pts[j - 1], pts[j]) <= tol) return o;
            }
        }
    }
    return null;
}
function moveObj(o, dx, dy) {
    if (o.type === 'stroke') for (const p of o.points) { p.x += dx; p.y += dy; }
    else { o.x += dx; o.y += dy; }
}

function eraserRadius() { return Math.max(6, penSize * 1.5); }
function eraseCircle(x, y, r) {
    let changed = false;
    const next = [];
    for (const o of objects) {
        if (o.type === 'text') {
            const b = bboxOf(o);
            const cx = Math.max(b.x, Math.min(x, b.x + b.w));
            const cy = Math.max(b.y, Math.min(y, b.y + b.h));
            if (Math.hypot(x - cx, y - cy) <= r) { changed = true; continue; }
            next.push(o);
        } else {
            const tol = r + strokeMaxWidth(o) / 2;
            let anyErased = false;
            const pieces = [];
            let cur = [];
            for (const p of o.points) {
                if (Math.hypot(p.x - x, p.y - y) <= tol) {
                    anyErased = true;
                    if (cur.length) { pieces.push(cur); cur = []; }
                } else cur.push(p);
            }
            if (cur.length) pieces.push(cur);
            if (!anyErased) { next.push(o); continue; }
            changed = true;
            for (const pc of pieces) if (pc.length) next.push(Object.assign({}, o, { points: pc }));
        }
    }
    if (changed) {
        objects = next;
        selection = selection.filter(o => objects.includes(o));
    }
    return changed;
}
function eraseLine(x0, y0, r0, x1, y1, r1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(d / Math.max(2, r / 2)));
    let changed = false;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (eraseCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t)) changed = true;
    }
    return changed;
}

function pushState() {
    if (undoStack.length >= MAX_UNDO) undoStack.shift();
    undoStack.push({ json: JSON.stringify(objects), h: canvas.height });
}
let restoreToken = 0;
function restoreState() {
    if (undoStack.length < 2) return;
    undoStack.pop();
    const prev = undoStack[undoStack.length - 1];
    const my = ++restoreToken;
    setTimeout(() => {
        if (my !== restoreToken) return;
        objects = JSON.parse(prev.json);
        selection = []; marquee = null; drag = null;
        canvas.height = prev.h;
        canvas.style.height = prev.h + 'px';
        extraHeight = Math.max(0, prev.h - baseHeight);
        redraw();
    }, 0);
}
undoBtn.addEventListener('click', restoreState);

clearBtn.addEventListener('click', () => {
    objects = []; selection = []; marquee = null;
    extraHeight = 0;
    applyHeight();
    redraw();
    pushState();
    boardPanel.scrollTo({ top: 0, behavior: 'smooth' });
});

expandBtn.addEventListener('click', () => {
    extraHeight += EXPAND_STEP;
    applyHeight();
    redraw();
    pushState();
    requestAnimationFrame(() => {
        boardPanel.scrollTo({ top: boardPanel.scrollHeight, behavior: 'smooth' });
    });
});

constrainPanel();
resizeCanvas();
pushState();
window.addEventListener('resize', () => { constrainPanel(); resizeCanvas(); });

const brushBtn = document.getElementById('brush-tool');
const eraserBtn = document.getElementById('eraser-tool');
const selectBtn = document.getElementById('select-tool');
const textBtn = document.getElementById('text-tool');
const toolButtons = { brush: brushBtn, eraser: eraserBtn, select: selectBtn, text: textBtn };
const cursors = { brush: 'crosshair', eraser: 'cell', select: 'default', text: 'text' };

function setTool(tool) {
    commitEditor();
    currentTool = tool;
    for (const k in toolButtons) toolButtons[k].classList.toggle('active', k === tool);
    selection = []; marquee = null;
    canvas.style.cursor = cursors[tool];
    redraw();
}
brushBtn.addEventListener('click', () => setTool('brush'));
eraserBtn.addEventListener('click', () => setTool('eraser'));
selectBtn.addEventListener('click', () => setTool('select'));
textBtn.addEventListener('click', () => setTool('text'));

const paletteBtn = document.getElementById('palette-btn');
const colorInput = document.getElementById('pen-color');
function updatePaletteColor(color) {
    penColor = color;
    paletteBtn.querySelector('i').style.color = color;
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const diff = Math.sqrt((r - 79) ** 2 + (g - 58) ** 2 + (b - 90) ** 2);
    paletteBtn.classList.toggle('needs-outline', diff < 60);
}
paletteBtn.addEventListener('click', () => colorInput.click());
colorInput.addEventListener('input', (e) => { updatePaletteColor(e.target.value); setTool('brush'); });
document.querySelectorAll('.color-swatch').forEach(el => {
    el.addEventListener('click', () => {
        updatePaletteColor(el.dataset.color);
        colorInput.value = el.dataset.color;
        setTool('brush');
    });
});
updatePaletteColor(penColor);
penSizeInput.addEventListener('input', (e) => penSize = +e.target.value);

let editingObj = null;
let editorPos = null;
let editorOpen = false;
function textSize() { return Math.max(16, penSize * 5); }
function openEditor(x, y, obj) {
    if (editorOpen) commitEditor();
    editorOpen = true;
    editingObj = obj || null;
    editorPos = { x, y };
    editor.value = obj ? obj.text : '';
    editor.style.fontSize = (obj ? obj.size : textSize()) + 'px';
    editor.style.color = penColor;
    editor.style.left = (canvas.offsetLeft + x) + 'px';
    editor.style.top = (canvas.offsetTop + y) + 'px';
    editor.hidden = false;
    setTimeout(() => editor.focus(), 0);
}
function commitEditor() {
    if (!editorOpen) return;
    editorOpen = false;
    const val = editor.value;
    let changed = false;
    if (editingObj) {
        if (val.trim() === '') { objects = objects.filter(o => o !== editingObj); changed = true; }
        else if (editingObj.text !== val) { editingObj.text = val; changed = true; }
        selection = [];
    } else if (val.trim() !== '' && editorPos) {
        objects.push({ type: 'text', x: editorPos.x, y: editorPos.y, text: val, color: penColor, size: textSize() });
        changed = true;
    }
    editingObj = null; editorPos = null;
    editor.hidden = true;
    if (changed) pushState();
    redraw();
}
function cancelEditor() {
    editorOpen = false;
    editingObj = null; editorPos = null;
    editor.hidden = true;
}
editor.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commitEditor();
    if (e.key === 'Escape') cancelEditor();
});
editor.addEventListener('blur', () => { if (editorOpen) commitEditor(); });

document.addEventListener('keydown', (e) => {
    const t = document.activeElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
        e.preventDefault();
        objects = objects.filter(o => !selection.includes(o));
        selection = [];
        pushState();
        redraw();
    }
    if (e.key === 'Escape') { selection = []; marquee = null; redraw(); }
});

function getCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
}
canvas.addEventListener('pointerdown', (e) => {
    const { x, y } = getCoords(e);
    pressureSmooth = (e.pointerType === 'pen' && typeof e.pressure === 'number') ? e.pressure : 0.5;

    if (currentTool === 'brush') {
        drawing = true;
        const w = penSize * pressureFactor(e);
        currentStroke = { type: 'stroke', points: [{ x, y, w }], color: penColor, size: penSize };
        objects.push(currentStroke);
        lastX = x; lastY = y;
        redraw();
        return;
    }
    if (currentTool === 'eraser') {
        drawing = true;
        eraseChanged = eraseCircle(x, y, eraserRadius());
        lastX = x; lastY = y;
        redraw();
        return;
    }
    if (currentTool === 'text') { openEditor(x, y, null); return; }
    if (currentTool === 'select') {
        const hit = hitTest({ x, y });
        if (hit) {
            if (!selection.includes(hit)) selection = [hit];
            drag = { lastX: x, lastY: y, moved: false };
        } else {
            selection = [];
            marquee = { x0: x, y0: y, x1: x, y1: y };
        }
        redraw();
    }
});
canvas.addEventListener('pointermove', (e) => {
    if (drawing && currentTool === 'brush' && currentStroke) {
        for (const ev of getCoalesced(e)) {
            const { x, y } = getCoords(ev);
            const w = penSize * pressureFactor(ev);
            const prev = currentStroke.points[currentStroke.points.length - 1];
            currentStroke.points.push({ x, y, w });
            ctx.strokeStyle = currentStroke.color;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = (prev.w + w) / 2;
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(x, y);
            ctx.stroke();
        }
        return;
    }
    if (drawing && currentTool === 'eraser') {
        for (const ev of getCoalesced(e)) {
            const { x, y } = getCoords(ev);
            const r = eraserRadius() * pressureFactor(ev);
            if (eraseLine(lastX, lastY, lastR, x, y, r)) eraseChanged = true;
            lastX = x; lastY = y; lastR = r;
        }
        redraw();
        return;
    }
    if (!drawing) {
        const { x, y } = getCoords(e);
        if (drag) {
            const dx = x - drag.lastX, dy = y - drag.lastY;
            if (dx || dy) drag.moved = true;
            for (const o of selection) moveObj(o, dx, dy);
            drag.lastX = x; drag.lastY = y;
            redraw();
            return;
        }
        if (marquee) {
            marquee.x1 = x; marquee.y1 = y;
            redraw();
        }
    }
});
canvas.addEventListener('pointerup', () => {
    if (drawing) {
        drawing = false;
        if (currentTool === 'brush') { currentStroke = null; pushState(); }
        if (currentTool === 'eraser' && eraseChanged) { eraseChanged = false; pushState(); }
        return;
    }
    if (drag) {
        if (drag.moved) pushState();
        drag = null;
        return;
    }
    if (marquee) {
        const r = normRect(marquee);
        marquee = null;
        if (r.w > 4 || r.h > 4) selection = objects.filter(o => intersects(bboxOf(o), r));
        redraw();
    }
});
canvas.addEventListener('pointerleave', () => {
    if (drawing) {
        drawing = false;
        if (currentTool === 'brush') { currentStroke = null; pushState(); }
        if (currentTool === 'eraser' && eraseChanged) { eraseChanged = false; pushState(); }
    }
});
canvas.addEventListener('dblclick', (e) => {
    if (currentTool !== 'select') return;
    const { x, y } = getCoords(e);
    const hit = hitTest({ x, y });
    if (hit && hit.type === 'text') {
        selection = [hit];
        openEditor(hit.x, hit.y, hit);
    }
});

function buildSaveData() {
    return {
        format: 'kawadesk',
        version: 1,
        savedAt: new Date().toISOString(),
        objects: objects,
        extraHeight: extraHeight,
        penColor: penColor,
        penSize: penSize,
        history: undoStack
    };
}

function applyLoaded(text, path) {
    const data = JSON.parse(text);
    if (!data || data.format !== 'kawadesk') throw new Error('это не кавайная доска! >_<');
    cancelEditor();
    undoStack = (Array.isArray(data.history) && data.history.length)
        ? data.history.slice(-MAX_UNDO) : [];
    if (Array.isArray(data.objects)) objects = data.objects;
    else if (undoStack.length) objects = JSON.parse(undoStack[undoStack.length - 1].json);
    else objects = [];
    extraHeight = Math.max(0, +data.extraHeight || 0);
    if (typeof data.penColor === 'string') updatePaletteColor(data.penColor);
    if (+data.penSize) { penSize = +data.penSize; penSizeInput.value = penSize; }
    selection = []; marquee = null; drag = null;
    currentName = path || null;
    applyHeight();
    redraw();
    if (!undoStack.length) pushState();
    boardPanel.scrollTo({ top: 0, behavior: 'smooth' });
}

newBtn.addEventListener('click', () => {
    if (objects.length && !confirm('Создать новую доску? Несохранённое пропадёт~ >_<')) return;
    cancelEditor();
    objects = []; selection = []; marquee = null; drag = null;
    extraHeight = 0;
    currentName = null;
    applyHeight();
    redraw();
    undoStack = [];
    pushState();
    boardPanel.scrollTo({ top: 0, behavior: 'smooth' });
});

saveBtn.addEventListener('click', async () => {
    const base = currentName
        ? currentName.replace(/^.*[\\/]/, '')
        : 'kawaii-board.kawadesk';
    const res = await eel.save_board_file(JSON.stringify(buildSaveData()), base)();
    if (res && res.ok) currentName = res.path;
    else if (res && res.error) alert('T_T Ой, ошибка сохранения: ' + res.error);
});

openBtn.addEventListener('click', async () => {
    const res = await eel.open_board_file()();
    if (res && res.ok) {
        try { applyLoaded(res.content, res.path); }
        catch (err) {
            alert('T_T Не удалось открыть доску: ' + (err && err.message ? err.message : err));
        }
    } else if (res && res.error) {
        alert('T_T Ой, ошибка открытия: ' + res.error);
    }
});

// ===== БЛОКИ =====
const BLOCK_TYPES = [
    { id: 'disasm', label: 'HEX', icon: 'fa-search', suffix: 'ASM~' },
    { id: 'asm', label: 'ASM', icon: 'fa-wrench', suffix: 'HEX~' },
    { id: 'converter', label: 'Переводим числа', icon: 'fa-exchange-alt', suffix: 'между системами~' },
];
function createBlock(type, label, icon, suffix) {
    const container = document.getElementById('blocks-container');
    const blockDiv = document.createElement('div');
    blockDiv.className = 'block';
    blockDiv.dataset.type = type;

    const title = document.createElement('div');
    title.className = 'block-title noselect';
    const iconEl = document.createElement('i');
    iconEl.className = `fas ${icon}`;
    title.appendChild(iconEl);
    title.appendChild(document.createTextNode(' ' + label + ' '));
    const arrow = document.createElement('i');
    arrow.className = 'fas fa-arrow-right';
    title.appendChild(arrow);
    title.appendChild(document.createTextNode(' ' + suffix));
    blockDiv.appendChild(title);

    if (type === 'disasm') {
        const input = document.createElement('textarea');
        input.placeholder = ':3 Похексь байтики~ Например: B8 34 12';
        input.rows = 2;
        blockDiv.appendChild(input);

        const modeSelect = document.createElement('select');
        ['16', '32', '64'].forEach(m => {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = m + '-bit';
            modeSelect.appendChild(opt);
        });
        blockDiv.appendChild(modeSelect);

        const btn = document.createElement('button');
        btn.innerHTML = '<i class="fas fa-code"></i> Расшифровать~';
        blockDiv.appendChild(btn);

        const output = document.createElement('div');
        output.className = 'output';
        output.textContent = 'Результатик~';
        blockDiv.appendChild(output);

        btn.addEventListener('click', async () => {
            const hex = input.value.trim();
            const mode = modeSelect.value;
            if (!hex) { output.textContent = '>_< Нужно ввести HEX~'; return; }
            try {
                const result = await eel.disassemble(hex, mode)();
                output.textContent = '^_^ Готово~\n' + result;
            } catch (err) {
                output.textContent = 'T_T Ой, ошибка: ' + err;
            }
        });
    }

    if (type === 'asm') {
        const input = document.createElement('textarea');
        input.placeholder = '^_^ Напиши инструкцию~ Например: mov eax, 0x1234';
        input.rows = 2;
        blockDiv.appendChild(input);

        const modeSelect = document.createElement('select');
        ['16', '32', '64'].forEach(m => {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = m + '-bit';
            modeSelect.appendChild(opt);
        });
        blockDiv.appendChild(modeSelect);

        const btn = document.createElement('button');
        btn.innerHTML = '<i class="fas fa-wrench"></i> Собрать~';
        blockDiv.appendChild(btn);

        const output = document.createElement('div');
        output.className = 'output';
        output.textContent = 'Результатик~';
        blockDiv.appendChild(output);

        btn.addEventListener('click', async () => {
            const asm = input.value.trim();
            const mode = modeSelect.value;
            if (!asm) { output.textContent = '>_< Нужна инструкция~'; return; }
            try {
                const result = await eel.assemble(asm, mode)();
                output.textContent = '^_^ Готово~\n' + result;
            } catch (err) {
                output.textContent = 'T_T Ой, ошибка: ' + err;
            }
        });
    }

    if (type === 'converter') {
        const input = document.createElement('input');
        input.placeholder = '^w^ Чиселко~';
        blockDiv.appendChild(input);

        const fromSelect = document.createElement('select');
        ['Dec', 'Hex', 'Bin', 'Oct'].forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s;
            fromSelect.appendChild(opt);
        });
        const toSelect = document.createElement('select');
        ['Dec', 'Hex', 'Bin', 'Oct'].forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s;
            toSelect.appendChild(opt);
        });

        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.gap = '8px';
        wrapper.style.marginTop = '6px';
        wrapper.style.alignItems = 'center';

        const labelFrom = document.createElement('span');
        labelFrom.textContent = 'из';
        wrapper.appendChild(labelFrom);
        wrapper.appendChild(fromSelect);

        const arrowIcon = document.createElement('i');
        arrowIcon.className = 'fas fa-arrow-right';
        arrowIcon.style.color = '#d48ab0';
        wrapper.appendChild(arrowIcon);

        const labelTo = document.createElement('span');
        labelTo.textContent = 'в';
        wrapper.appendChild(labelTo);
        wrapper.appendChild(toSelect);
        blockDiv.appendChild(wrapper);

        const btn = document.createElement('button');
        btn.innerHTML = '<i class="fas fa-exchange-alt"></i> Перевести~';
        blockDiv.appendChild(btn);

        const output = document.createElement('div');
        output.className = 'output';
        output.textContent = 'Результатик~';
        blockDiv.appendChild(output);

        btn.addEventListener('click', async () => {
            const val = input.value.trim();
            const from = fromSelect.value;
            const to = toSelect.value;
            if (!val) { output.textContent = '>_< Нужно чиселко~'; return; }
            try {
                const result = await eel.convert_base(val, from, to)();
                output.textContent = '^_^ Готово~\n' + result;
            } catch (err) {
                output.textContent = 'T_T Ой, ошибка: ' + err;
            }
        });
    }

    container.appendChild(blockDiv);
}
BLOCK_TYPES.forEach(bt => createBlock(bt.id, bt.label, bt.icon, bt.suffix));
