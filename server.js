const express = require('express');
const path = require('path');
const app = express();
const port = 3000;
const fs = require('fs');

// Serve static files from the 'public' directory
// The 'path.join' ensures the path works correctly across different operating systems
app.use(express.static(path.join(__dirname, 'client')));

// Set up a basic route for the home page
app.get('/', (req, res) => {
  res.send('Hello, you can now access static files!');
});

//make a post request endpoint /logevent that logs the event to the console
app.post('/logevent', express.json(), (req, res) => {
  console.log('Event logged:', req.body);
  //write the log to a file with the current timestamp as filename, log it to the logs directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logDir = path.join(__dirname, 'logs');
  const logFile = path.join(logDir, `${timestamp}.log`);

  // Ensure the logs directory exists
  fs.mkdir(logDir, { recursive: true }, (err) => {
    if (err) {
      console.error('Error creating logs directory:', err);
      return res.status(500).send('Internal Server Error');
    }
    const logEntry = req.body.log.map(line => `${new Date().toISOString()} | ${line}`).join('\n') + '\n';

    // Write the log entry to the file
    fs.appendFile(logFile, logEntry, (err) => {
      if (err) {
        console.error('Error writing to log file:', err);
        return res.status(500).send('Internal Server Error');
      }
      res.status(200).send('Event logged');
    });

    // Now parse the log and also log the parsed version to a json file with the same name but .json extension
    const parsed = parseWhackAMoleLog(logEntry);
    const logFileJson = path.join(logDir, `${timestamp}.json`);
    fs.writeFile(logFileJson, JSON.stringify(parsed, null, 2), (err) => {
      if (err) {
        console.error('Error writing to JSON log file:', err);
      } else {
        console.log('Parsed log written to JSON file:', logFileJson);
      }
    });



  });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});


/**
 * Parse Whack-a-Mole game log text into structured JSON.
 * Accepts the exact one-line-per-event format from the game.
 *
 * @param {string} text - The raw log text.
 * @returns {{
 *   gameId: string,
 *   settings?: {
 *     grid: { rows: number, cols: number },
 *     duration_ms: number,
 *     mole_up_ms: { min: number, max: number },
 *     idle_gap_ms: { min: number, max: number }
 *   },
 *   events: Array<any>
 * }}
 */
function parseWhackAMoleLog(text) {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const events = [];
  let gameId = null;
  let settings;

  // Helpers
  const parseFloatSafe = s => (s == null ? undefined : parseFloat(s));
  const parseIntSafe = s => (s == null ? undefined : parseInt(s, 10));
  const toNum = v => (typeof v === 'string' ? Number(v) : v);

  function parseSettingsBlob(blob) {
    // blob example: "settings={grid=4x4,duration_ms=10000,mole_up_ms=[650,1200],idle_gap_ms=[220,500]}"
    const m = blob.match(/settings=\{(.+)\}\s*$/);
    if (!m) return undefined;
    const body = m[1];

    // grid
    const gridMatch = body.match(/grid=(\d+)x(\d+)/);
    const rows = gridMatch ? parseInt(gridMatch[1], 10) : undefined;
    const cols = gridMatch ? parseInt(gridMatch[2], 10) : undefined;

    // duration
    const durMatch = body.match(/duration_ms=(\d+)/);
    const duration_ms = durMatch ? parseInt(durMatch[1], 10) : undefined;

    // arrays like [a,b]
    const upMatch = body.match(/mole_up_ms=\[(\d+),\s*(\d+)\]/);
    const idleMatch = body.match(/idle_gap_ms=\[(\d+),\s*(\d+)\]/);

    return {
      grid: rows && cols ? { rows, cols } : undefined,
      duration_ms,
      mole_up_ms: upMatch
        ? { min: parseInt(upMatch[1], 10), max: parseInt(upMatch[2], 10) }
        : undefined,
      idle_gap_ms: idleMatch
        ? { min: parseInt(idleMatch[1], 10), max: parseInt(idleMatch[2], 10) }
        : undefined
    };
  }

  for (const line of lines) {
    // Base split: ISO | t_rel | gameId=... | payload
    const base = line.match(
      /^\s*(\S+)\s*\|\s*([\d.]+)s\s*\|\s*gameId=([^\s|]+)\s*\|\s*(.+?)\s*$/
    );
    if (!base) continue;

    const ts = base[1];
    const t_rel_s = parseFloat(base[2]);
    const gid = base[3];
    const payload = base[4];

    if (!gameId) gameId = gid;

    // Types:
    // GAME_START | settings={...}
    // GAME_END | final_score=#
    // SHOW  @ rNcM (#idx)
    // HIDE  @ rNcM (#idx)
    // HIT   @ rNcM (#idx) | pos_rel=(x,y) | score=#
    // MISS  @ rNcM (#idx) | pos_rel=(x,y)

    // Try GAME_START
    if (/^GAME_START\b/.test(payload)) {
      const s = parseSettingsBlob(payload);
      settings = s || settings;
      events.push({
        ts,
        t_rel_s,
        type: 'GAME_START',
        ...(s ? { settings: s } : {})
      });
      continue;
    }

    // Try GAME_END
    if (/^GAME_END\b/.test(payload)) {
      const m = payload.match(/final_score=(\d+)/);
      events.push({
        ts,
        t_rel_s,
        type: 'GAME_END',
        final_score: m ? parseInt(m[1], 10) : undefined
      });
      continue;
    }

    // SHOW / HIDE / HIT / MISS with cell + optional details
    const cellRe =
      /^(SHOW|HIDE|HIT|MISS)\s*@\s*r(\d+)c(\d+)\s*\(#(\d+)\)(?:\s*\|\s*pos_rel=\(([\d.]+),\s*([\d.]+)\))?(?:\s*\|\s*score=(\d+))?$/;
    const cm = payload.match(cellRe);
    if (cm) {
      const type = cm[1];
      const row = parseInt(cm[2], 10);
      const col = parseInt(cm[3], 10);
      const index = parseInt(cm[4], 10);
      const x = parseFloatSafe(cm[5]);
      const y = parseFloatSafe(cm[6]);
      const score = parseIntSafe(cm[7]);

      const evt = {
        ts,
        t_rel_s,
        type,
        cell: { row, col, index }
      };
      if (!Number.isNaN(x) && !Number.isNaN(y) && x !== undefined && y !== undefined) {
        evt.pos_rel = { x: toNum(x), y: toNum(y) };
      }
      if (score !== undefined && !Number.isNaN(score)) {
        evt.score = score;
      }
      events.push(evt);
      continue;
    }

    // Fallback: keep unknown lines minimally parsed
    events.push({ ts, t_rel_s, type: 'UNKNOWN', raw: payload });
  }

  return { gameId: gameId || null, settings, events };
}

/* ---------- Example usage ---------- */
const rawLog = `2025-09-09T18:23:10.198Z | 0.000s | gameId=20250909-202300-172-6e68 | GAME_START | settings={grid=4x4,duration_ms=10000,mole_up_ms=[650,1200],idle_gap_ms=[220,500]}
2025-09-09T18:23:10.198Z | 0.105s | gameId=20250909-202300-172-6e68 | SHOW  @ r4c1 (#12)
2025-09-09T18:23:10.198Z | 0.510s | gameId=20250909-202300-172-6e68 | MISS  @ r1c2 (#1) | pos_rel=(0.541,0.594)
2025-09-09T18:23:10.198Z | 0.951s | gameId=20250909-202300-172-6e68 | MISS  @ r2c2 (#5) | pos_rel=(0.524,0.432)
2025-09-09T18:23:10.198Z | 1.270s | gameId=20250909-202300-172-6e68 | HIDE  @ r4c1 (#12)
2025-09-09T18:23:10.198Z | 1.462s | gameId=20250909-202300-172-6e68 | MISS  @ r4c1 (#12) | pos_rel=(0.745,0.185)
2025-09-09T18:23:10.198Z | 1.572s | gameId=20250909-202300-172-6e68 | SHOW  @ r2c1 (#4)
2025-09-09T18:23:10.198Z | 2.213s | gameId=20250909-202300-172-6e68 | HIT   @ r2c1 (#4) | pos_rel=(0.694,0.653) | score=1
2025-09-09T18:23:10.198Z | 2.787s | gameId=20250909-202300-172-6e68 | SHOW  @ r3c1 (#8)
2025-09-09T18:23:10.198Z | 3.435s | gameId=20250909-202300-172-6e68 | HIT   @ r3c1 (#8) | pos_rel=(0.354,0.594) | score=2
2025-09-09T18:23:10.198Z | 4.218s | gameId=20250909-202300-172-6e68 | SHOW  @ r3c4 (#11)
2025-09-09T18:23:10.198Z | 4.777s | gameId=20250909-202300-172-6e68 | HIT   @ r3c4 (#11) | pos_rel=(0.753,0.449) | score=3
2025-09-09T18:23:10.198Z | 5.354s | gameId=20250909-202300-172-6e68 | SHOW  @ r1c3 (#2)
2025-09-09T18:23:10.198Z | 5.938s | gameId=20250909-202300-172-6e68 | HIT   @ r1c3 (#2) | pos_rel=(0.345,0.789) | score=4
2025-09-09T18:23:10.198Z | 6.618s | gameId=20250909-202300-172-6e68 | SHOW  @ r4c4 (#15)
2025-09-09T18:23:10.198Z | 7.290s | gameId=20250909-202300-172-6e68 | HIT   @ r4c4 (#15) | pos_rel=(0.396,0.457) | score=5
2025-09-09T18:23:10.198Z | 7.946s | gameId=20250909-202300-172-6e68 | SHOW  @ r2c3 (#6)
2025-09-09T18:23:10.198Z | 8.459s | gameId=20250909-202300-172-6e68 | HIT   @ r2c3 (#6) | pos_rel=(0.813,0.406) | score=6
2025-09-09T18:23:10.198Z | 9.238s | gameId=20250909-202300-172-6e68 | SHOW  @ r1c2 (#1)
2025-09-09T18:23:10.198Z | 9.765s | gameId=20250909-202300-172-6e68 | HIT   @ r1c2 (#1) | pos_rel=(0.405,0.730) | score=7
2025-09-09T18:23:10.198Z | 10.005s | gameId=20250909-202300-172-6e68 | GAME_END | final_score=7`;

const parsed = parseWhackAMoleLog(rawLog);
console.log(JSON.stringify(parsed, null, 2));
