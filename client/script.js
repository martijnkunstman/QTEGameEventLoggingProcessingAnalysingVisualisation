// --- Config ---
  const GRID_SIZE = 4;                 // 4x4
  const GAME_DURATION_MS = 30_000;     // 30 seconds
  const MOLE_UP_MIN_MS = 650;          // realistic duration range
  const MOLE_UP_MAX_MS = 1200;
  const IDLE_GAP_MIN_MS = 220;         // small gap between moles
  const IDLE_GAP_MAX_MS = 500;

  // --- State ---
  const gridEl  = document.getElementById('grid');
  const scoreEl = document.getElementById('score');
  const timeEl  = document.getElementById('time');
  const logEl   = document.getElementById('log');
  const startBtn= document.getElementById('startBtn');

  let cells = [];
  let moles = [];
  let score = 0;
  let startTime = 0;
  let endTime = 0;
  let timerInterval = null;

  let moleIndex = -1;          // current mole cell index
  let moleUpTimeout = null;    // timeout for auto-hide
  let nextMoleTimeout = null;  // timeout between moles
  let moleActive = false;      // a mole is currently visible
  let moleHit = false;         // current mole already hit (prevents double scoring)
  let playing = false;

  let gameId = "";             // unique per game
  const logLines = [];

  // --- Helpers ---
  const pad2 = n => String(n).padStart(2, '0');
  function genGameId() {
    // Simple k-sortable ID: YYYYMMDD-HHMMSS-mmm-4hex
    const d = new Date();
    const part =
      d.getFullYear().toString() +
      pad2(d.getMonth()+1) +
      pad2(d.getDate()) + "-" +
      pad2(d.getHours()) +
      pad2(d.getMinutes()) +
      pad2(d.getSeconds()) + "-" +
      String(d.getMilliseconds()).padStart(3,'0');
    const rand = Math.floor(Math.random()*0xffff).toString(16).padStart(4,'0');
    return `${part}-${rand}`;
  }
  function stamp() {
    if (!startTime) return "00.000s";
    const ms = Date.now() - startTime;
    return `${(ms/1000).toFixed(3)}s`;
  }
  function rcFromIndex(i) {
    const r = Math.floor(i / GRID_SIZE) + 1;
    const c = (i % GRID_SIZE) + 1;
    return `r${r}c${c}`;
  }
  function pushLog(line) {
    const msg = `${stamp()} | gameId=${gameId} | ${line}`;
    logLines.push(msg);
    if (playing) {
      const tail = logLines.slice(-6).join('\n');
      logEl.textContent = tail;
      logEl.scrollTop = logEl.scrollHeight;
    }
  }
  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function relPosIn(el, clientX, clientY) {
    const r = el.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    // clamp to [0,1] just in case
    const clamp = v => Math.max(0, Math.min(1, v));
    return { x: clamp(x), y: clamp(y) };
  }
  function fmt01(n) { return n.toFixed(3); }

  // --- Build grid ---
  function buildGrid() {
    gridEl.innerHTML = '';
    cells = [];
    moles = [];
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `Hole ${rcFromIndex(i)}`);
      cell.dataset.index = i;

      const mole = document.createElement('div');
      mole.className = 'mole';
      mole.setAttribute('aria-hidden', 'true');

      cell.appendChild(mole);
      gridEl.appendChild(cell);

      cells.push(cell);
      moles.push(mole);
    }
  }

  // --- Game flow ---
  function startGame() {
    if (playing) return;

    // reset
    score = 0;
    updateScore();
    timeEl.textContent = (GAME_DURATION_MS/1000).toFixed(1);
    logLines.length = 0;
    logEl.textContent = '';
    clearTimeouts();
    hideMole(true);

    startTime = Date.now();
    endTime = startTime + GAME_DURATION_MS;
    playing = true;
    startBtn.disabled = true;

    gameId = genGameId();

    // Log settings at start
    pushLog(
      `GAME_START | settings={grid=${GRID_SIZE}x${GRID_SIZE},duration_ms=${GAME_DURATION_MS},mole_up_ms=[${MOLE_UP_MIN_MS},${MOLE_UP_MAX_MS}],idle_gap_ms=[${IDLE_GAP_MIN_MS},${IDLE_GAP_MAX_MS}]}` 
    );

    startTimer();
    scheduleNextMole(100); // quick first mole
  }

  function endGame() {
    playing = false;
    clearTimeouts();
    hideMole(true);

    pushLog(`GAME_END | final_score=${score}`);
    // Show full log
    logEl.textContent = logLines.join('\n');
    logEl.scrollTop = logEl.scrollHeight;

    startBtn.disabled = false;
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const now = Date.now();
      const msLeft = Math.max(0, endTime - now);
      timeEl.textContent = (msLeft/1000).toFixed(1);
      if (msLeft <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        endGame();
      }
    }, 100);
  }

  function scheduleNextMole(delay = randomBetween(IDLE_GAP_MIN_MS, IDLE_GAP_MAX_MS)) {
    if (!playing) return;
    nextMoleTimeout = setTimeout(() => {
      if (!playing) return;
      showRandomMole();
    }, delay);
  }

  function showRandomMole() {
    if (!playing) return;
    // Only one visible at a time
    hideMole(true);

    // Pick a hole different from last one for variety
    let idx;
    do { idx = Math.floor(Math.random() * cells.length); }
    while (cells.length > 1 && idx === moleIndex);

    moleIndex = idx;
    const mole = moles[idx];
    moleHit = false;
    moleActive = true;
    mole.classList.add('visible');

    pushLog(`SHOW  @ ${rcFromIndex(idx)} (#${idx})`);

    // Auto hide after realistic duration
    const upMs = randomBetween(MOLE_UP_MIN_MS, MOLE_UP_MAX_MS);
    moleUpTimeout = setTimeout(() => {
      if (moleActive && !moleHit) {
        pushLog(`HIDE  @ ${rcFromIndex(idx)} (#${idx})`);
        hideMole();
        scheduleNextMole();
      }
    }, upMs);
  }

  function hideMole(immediate = false) {
    if (moleIndex < 0) return;
    const mole = moles[moleIndex];
    moleActive = false;

    if (immediate) {
      mole.classList.remove('visible', 'hit');
      mole.style.opacity = '';
      moleIndex = -1;
      return;
    }

    mole.classList.remove('visible', 'hit');
    moleIndex = -1;
  }

  function updateScore() {
    scoreEl.textContent = String(score);
  }

  function clearTimeouts() {
    if (moleUpTimeout) { clearTimeout(moleUpTimeout); moleUpTimeout = null; }
    if (nextMoleTimeout) { clearTimeout(nextMoleTimeout); nextMoleTimeout = null; }
  }

  // --- Interaction ---
  gridEl.addEventListener('click', (e) => {
    if (!playing) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const idx = Number(cell.dataset.index);
    const mole = moles[idx];

    // Relative mouse position inside the clicked cell (0..1)
    const { x, y } = relPosIn(cell, e.clientX, e.clientY);
    const posStr = `pos_rel=(${fmt01(x)},${fmt01(y)})`;

    if (moleActive && idx === moleIndex && !moleHit) {
      // Register hit
      moleHit = true;
      score += 1;
      updateScore();
      pushLog(`HIT   @ ${rcFromIndex(idx)} (#${idx}) | ${posStr} | score=${score}`);

      if (moleUpTimeout) { clearTimeout(moleUpTimeout); moleUpTimeout = null; }

      // Visualize: turn red and fade out
      mole.classList.add('hit');
      setTimeout(() => {
        if (!playing) return;
        hideMole();
        scheduleNextMole();
      }, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--fade-ms')) || 300);

    } else {
      // MISS: flash the rim (orange), log it with relative position
      pushLog(`MISS  @ ${rcFromIndex(idx)} (#${idx}) | ${posStr}`);
      cell.classList.remove('missFlash'); // restart animation
      void cell.offsetWidth;
      cell.classList.add('missFlash');
    }
  });

  // --- Init ---
  buildGrid();
  startBtn.addEventListener('click', startGame);