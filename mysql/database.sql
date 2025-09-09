-- =================================
-- MySQL 8.0 schema (InnoDB / utf8mb4)
-- =================================
CREATE DATABASE IF NOT EXISTS whackamole CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE whackamole;

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

CREATE INDEX game_events_game_idx ON game_events(game_id);
CREATE INDEX game_events_type_idx ON game_events(type);
CREATE INDEX game_events_ts_idx   ON game_events(ts);