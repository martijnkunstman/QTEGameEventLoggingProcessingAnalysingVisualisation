// Read JSON from the inline <script type="application/json" id="data">
const raw = document.getElementById('data').textContent.trim();
const game = JSON.parse(raw);

// ----- Basic refs
const gridEl = document.getElementById('grid');
const scoreChartEl = document.getElementById('scoreChart');
const timelineEl = document.getElementById('timeline');
const eventsListEl = document.getElementById('eventsList');
const gameIdEl = document.getElementById('gameId');
const durationEl = document.getElementById('duration');
const finalScoreEl = document.getElementById('finalScore');
const scrubberEl = document.getElementById('scrubber');
const tNowEl = document.getElementById('tNow');

// ----- Derived data
const rows = game.settings.grid.rows;
const cols = game.settings.grid.cols;
const duration = game.settings.duration_ms / 1000;
const events = game.events.slice().sort((a, b) => a.t_rel_s - b.t_rel_s);

const finalScore =
  events.findLast?.(e => e.type === 'GAME_END')?.final_score ??
  (events.filter(e => e.type === 'HIT').at(-1)?.score ?? 0);

// Score series (step chart)
const scorePoints = [{ t: 0, s: 0 }];
for (const e of events) {
  if (e.type === 'HIT') scorePoints.push({ t: e.t_rel_s, s: e.score });
}
if (scorePoints.at(-1).t < duration) scorePoints.push({ t: duration, s: finalScore });

// Per-cell stats
const indexFor = (r, c) => (r - 1) * cols + (c - 1);
const cells = Array.from({ length: rows * cols }, (_, i) => ({
  index: i,
  row: Math.floor(i / cols) + 1,
  col: (i % cols) + 1,
  shows: 0,
  hits: 0,
  misses: 0
}));

for (const e of events) {
  if (!e.cell) continue;
  const idx = e.cell.index ?? indexFor(e.cell.row, e.cell.col);
  const cell = cells[idx];
  if (!cell) continue;
  if (e.type === 'SHOW') cell.shows++;
  if (e.type === 'HIT') { cell.hits++; cell.shows = Math.max(cell.shows, 1); }
  if (e.type === 'MISS') cell.misses++;
}

// ----- Header meta
gameIdEl.textContent = game.gameId;
durationEl.textContent = `${duration.toFixed(3)}s`;
finalScoreEl.textContent = finalScore.toString();

// ----- Grid heatmap
function renderGrid() {
  gridEl.style.setProperty('--rows', rows);
  gridEl.style.setProperty('--cols', cols);
  gridEl.innerHTML = '';

  // Normalize intensity by max shows
  const maxShows = Math.max(1, ...cells.map(c => c.shows));
  for (const cell of cells) {
    const el = document.createElement('button');
    el.className = 'cell';
    const intensity = cell.shows / maxShows; // 0..1
    el.style.setProperty('--intensity', intensity.toString());

    const acc = document.createElement('div');
    acc.className = 'cell-accents';
    // little dots for hits/misses
    const dots = [];
    for (let i = 0; i < cell.hits; i++) dots.push('<span class="dot hit"></span>');
    for (let i = 0; i < cell.misses; i++) dots.push('<span class="dot miss"></span>');
    acc.innerHTML = dots.join('');

    el.innerHTML = `
      <div class="cell-label">${cell.row},${cell.col}</div>
      <div class="cell-stats">
        <span title="Shows"><span class="dot show"></span>${cell.shows}</span>
        <span title="Hits"><span class="dot hit"></span>${cell.hits}</span>
        <span title="Misses"><span class="dot miss"></span>${cell.misses}</span>
      </div>
    `;
    el.appendChild(acc);
    el.title = `Cell ${cell.row},${cell.col}
Shows: ${cell.shows}
Hits:  ${cell.hits}
Misses:${cell.misses}`;

    gridEl.appendChild(el);
  }
}

// ----- Score chart (SVG, responsive)
function renderScoreChart(tNow = 0) {
  const W = 800, H = 300, pad = 36;
  const x = t => pad + (t / duration) * (W - 2 * pad);
  const y = s => H - pad - (s / Math.max(1, finalScore)) * (H - 2 * pad);

  const ticksX = 10;
  const ticksY = Math.max(2, finalScore);

  let dGrid = '';
  // vertical grid
  for (let i = 0; i <= ticksX; i++) {
    const xx = pad + (i / ticksX) * (W - 2 * pad);
    dGrid += `M${xx},${pad} L${xx},${H - pad} `;
  }
  // horizontal grid
  for (let i = 0; i <= ticksY; i++) {
    const yy = pad + (i / ticksY) * (H - 2 * pad);
    dGrid += `M${pad},${H - yy + pad} L${W - pad},${H - yy + pad} `;
  }

  // step path
  let d = `M${x(0)},${y(0)}`;
  for (let i = 1; i < scorePoints.length; i++) {
    const p0 = scorePoints[i - 1];
    const p1 = scorePoints[i];
    // horizontal to new time
    d += ` H${x(p1.t)} V${y(p1.s)}`;
  }

  // playhead
  const playX = x(Math.max(0, Math.min(duration, tNow)));

  scoreChartEl.innerHTML = `
    <defs>
      <clipPath id="clip">
        <rect x="0" y="0" width="${W}" height="${H}" />
      </clipPath>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" class="bg" />
    <path d="${dGrid}" class="grid" />
    <g class="axes">
      <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" class="axis"/>
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" class="axis"/>
      <text x="${W - pad}" y="${H - 8}" class="tick">time (s)</text>
      <text x="${pad + 6}" y="${pad + 12}" class="tick">score</text>
    </g>
    <path d="${d}" class="line" />
    <line x1="${playX}" y1="${pad}" x2="${playX}" y2="${H - pad}" class="playhead"/>
  `;
}

// ----- Timeline (SVG dots by event type)
function renderTimeline(tNow = 0) {
  const W = 800, H = 120, pad = 20;
  const x = t => pad + (t / duration) * (W - 2 * pad);
  const rowY = {
    GAME_START: 30,
    SHOW: 60,
    HIT: 90,
    MISS: 90,
    GAME_END: 30
  };

  const circles = events.map(e => {
    const cls = e.type.toLowerCase();
    const y = rowY[e.type] ?? 60;
    const title = `${e.type} @ ${e.t_rel_s.toFixed(3)}s` +
      (e.cell ? ` (r${e.cell.row},c${e.cell.col})` : '') +
      (e.score != null ? ` | score=${e.score}` : '');
    return `<circle cx="${x(e.t_rel_s)}" cy="${y}" r="6" class="evt ${cls}">
      <title>${title}</title>
    </circle>`;
  }).join('');

  const playX = x(Math.max(0, Math.min(duration, tNow)));

  timelineEl.innerHTML = `
    <rect x="0" y="0" width="${W}" height="${H}" class="bg" />
    <g class="timeline-rows">
      <text x="${pad}" y="34" class="lab">START/END</text>
      <text x="${pad}" y="64" class="lab">SHOW</text>
      <text x="${pad}" y="94" class="lab">HIT/MISS</text>
      <line x1="${pad}" y1="30" x2="${W - pad}" y2="30" class="rowline"/>
      <line x1="${pad}" y1="60" x2="${W - pad}" y2="60" class="rowline"/>
      <line x1="${pad}" y1="90" x2="${W - pad}" y2="90" class="rowline"/>
    </g>
    <g class="events">${circles}</g>
    <line x1="${playX}" y1="${pad}" x2="${playX}" y2="${H - pad}" class="playhead"/>
  `;
}

// ----- Events list
function renderEventList() {
  const fmt = n => n.toFixed(3);
  eventsListEl.innerHTML = events.map(e => {
    const where = e.cell ? ` (r${e.cell.row},c${e.cell.col})` : '';
    const extra = [
      e.score != null ? `score=${e.score}` : null,
      e.pos_rel ? `pos=(${e.pos_rel.x},${e.pos_rel.y})` : null
    ].filter(Boolean).join(' · ');
    return `
      <div class="event">
        <div class="etype ${e.type.toLowerCase()}">${e.type}</div>
        <div class="etime">@ ${fmt(e.t_rel_s)}s</div>
        <div class="edetail">${where}${extra ? ' — ' + extra : ''}</div>
      </div>
    `;
  }).join('');
}

// ----- Scrubber interaction
function setupScrubber() {
  scrubberEl.max = duration;
  scrubberEl.value = 0;
  const update = () => {
    const t = parseFloat(scrubberEl.value);
    tNowEl.textContent = `${t.toFixed(3)}s`;
    renderScoreChart(t);
    renderTimeline(t);
  };
  scrubberEl.addEventListener('input', update);
  update();
}

// ----- Init
function init() {
  renderGrid();
  renderEventList();
  setupScrubber();
  // Make SVGs responsive to container size
  const ro = new ResizeObserver(() => {
    // just re-render to keep strokes crisp after CSS layout changes
    renderScoreChart(parseFloat(scrubberEl.value));
    renderTimeline(parseFloat(scrubberEl.value));
  });
  ro.observe(scoreChartEl);
  ro.observe(timelineEl);
}
init();
