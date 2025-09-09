const express = require('express');
const path = require('path');
const app = express();
const port = 3000;
const fs = require('fs');
const mysql = require('mysql');
const dbconnection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'whackamole'
});

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

    /*
    -- 1) Games (one row per game)
CREATE TABLE IF NOT EXISTS games (
  game_id         VARCHAR(64) PRIMARY KEY,
  started_at      DATETIME(3) NOT NULL,    -- store UTC
  duration_ms     INT         NOT NULL,
  grid_rows       SMALLINT    NOT NULL,
  grid_cols       SMALLINT    NOT NULL,
  mole_up_min_ms  INT         NOT NULL,
  mole_up_max_ms  INT         NOT NULL,
  idle_gap_min_ms INT         NOT NULL,
  idle_gap_max_ms INT         NOT NULL,
  ended_at        DATETIME(3) NULL,        -- convenience
  final_score     INT         NULL
) ENGINE=InnoDB;

-- 2) Events (many rows per game)
CREATE TABLE IF NOT EXISTS game_events (
  event_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id     VARCHAR(64) NOT NULL,
  ts          DATETIME(3) NOT NULL,        -- UTC
  t_rel_s     DECIMAL(8,3) NOT NULL,
  type        ENUM('GAME_START','GAME_END','SHOW','HIDE','HIT','MISS') NOT NULL,
  cell_row    SMALLINT NULL,
  cell_col    SMALLINT NULL,
  cell_index  SMALLINT NULL,
  pos_rel_x   DECIMAL(5,3) NULL,           -- 0..1 when present
  pos_rel_y   DECIMAL(5,3) NULL,
  score       INT NULL,                    -- running score on HIT
  final_score INT NULL,                    -- only on GAME_END
  PRIMARY KEY (event_id),
  CONSTRAINT fk_game_events_game
    FOREIGN KEY (game_id) REFERENCES games(game_id)
    ON DELETE CASCADE
) ENGINE=InnoDB;
 */

    //insert the json into the database
    if (parsed.gameId) {
      const game = parsed;
      const gameInsert = `
        INSERT INTO games (game_id, started_at, duration_ms, grid_rows, grid_cols, mole_up_min_ms, mole_up_max_ms, idle_gap_min_ms, idle_gap_max_ms, ended_at, final_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE ended_at = VALUES(ended_at), final_score = VALUES(final_score)`;

      game.startedAt = game.events.find(e => e.type === 'GAME_START')?.ts || new Date().toISOString();
      game.endedAt = game.events.find(e => e.type === 'GAME_END')?.ts || new Date().toISOString();
      game.final_score = game.events.find(e => e.type === 'GAME_END')?.final_score || 0;

      const gameValues = [
        game.gameId,
        new Date(game.startedAt),
        game.settings.duration_ms,
        game.settings.grid?.rows,
        game.settings.grid?.cols,
        game.settings.mole_up_ms?.min,
        game.settings.mole_up_ms?.max,
        game.settings.idle_gap_ms?.min,
        game.settings.idle_gap_ms?.max,
        new Date(game.endedAt),
        game.final_score
      ];

      dbconnection.query(gameInsert, gameValues, (err) => {
        if (err) {
          console.error('Error inserting game into database:', err);
        } else {
          console.log('Game inserted/updated in database:', game.gameId);
        }
      });

      //insert events

      const eventInsert = `
        INSERT INTO game_events (game_id, ts, t_rel_s, type, cell_row, cell_col, cell_index, pos_rel_x, pos_rel_y, score, final_score)
        VALUES ?`;
      const eventValues = game.events.map(e => [
        game.gameId,
        new Date(e.ts),
        e.t_rel_s,
        e.type,
        e.cell?.row || null,
        e.cell?.col || null,
        e.cell?.index || null,
        e.pos_rel?.x || null,
        e.pos_rel?.y || null,
        e.score || null,
        e.type === 'GAME_END' ? e.final_score : null
      ]);        

      dbconnection.query(eventInsert, [eventValues], (err) => {
        if (err) {
          console.error('Error inserting game events into database:', err);
        } else {
          console.log('Game events inserted into database:', game.gameId);
        }
      });
    } else {
      console.warn('No gameId found in parsed log, skipping database insert.');
    }
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