-- Rodeo schema (D1)
CREATE TABLE IF NOT EXISTS intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  ask TEXT NOT NULL,                -- the request, in the owner's words
  checks TEXT NOT NULL DEFAULT '[]',-- JSON array of plain-English checks
  status TEXT NOT NULL,             -- queued, drafting, racing, awaiting_owner, merging, replaying, merged, rejected, undoing, undone, no_winner, replay_failed, error
  base_commit TEXT,                 -- main when the race started
  winner_lane INTEGER,
  merged_commit TEXT,
  merged_parent TEXT,
  changed_paths TEXT,
  replayed INTEGER DEFAULT 0,       -- 1 if the request was rebuilt on newer code at merge time
  note TEXT,
  mode TEXT DEFAULT 'smart',        -- smart (one rider first) or full (all riders at once)
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  ai_calls INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lanes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  rider TEXT NOT NULL,
  model TEXT NOT NULL,
  fork TEXT,                        -- the rider's own Artifacts repo
  commit_hash TEXT,
  stage TEXT NOT NULL DEFAULT 'waiting', -- waiting, fork, build, push, judge, done, out
  score INTEGER, passed INTEGER, total INTEGER,
  lines_changed INTEGER,
  changed_paths TEXT,
  results TEXT,                     -- the judge's verdict per check, as JSON
  note TEXT, error TEXT,
  tokens INTEGER DEFAULT 0,
  started_at INTEGER, finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lanes_intent ON lanes(intent_id);
CREATE INDEX IF NOT EXISTS idx_events_intent ON events(intent_id);
