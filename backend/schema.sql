-- Applied once with `python apply_schema.py`. Safe to re-run (everything is IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS trips (
  id             TEXT PRIMARY KEY,
  destination    TEXT NOT NULL,
  country_code   TEXT,              -- internal, not in API contract
  local_currency TEXT,              -- internal
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  day_start      TIME NOT NULL,
  day_end        TIME NOT NULL,
  travellers     INT  NOT NULL DEFAULT 1,
  interests      TEXT[] NOT NULL DEFAULT '{}',
  home_currency  TEXT NOT NULL DEFAULT 'GBP',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS places (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  name_english TEXT,
  category     TEXT,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  confidence   REAL,
  source_url   TEXT,
  ts           TEXT,                -- video timestamp, "02:14"
  tip          TEXT,
  origin       TEXT NOT NULL DEFAULT 'import'   -- 'import' | 'ai'
);
CREATE INDEX IF NOT EXISTS places_trip_id_idx ON places (trip_id);

CREATE TABLE IF NOT EXISTS itineraries (
  trip_id    TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  data       JSONB NOT NULL,        -- the full Itinerary response
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holidays (
  country_code TEXT NOT NULL,
  date         DATE NOT NULL,
  name         TEXT NOT NULL,
  PRIMARY KEY (country_code, date)
);

-- Tiger Data / TimescaleDB feature: FX history as a hypertable
CREATE TABLE IF NOT EXISTS fx_rates (
  time   TIMESTAMPTZ NOT NULL,
  base   TEXT NOT NULL,
  quote  TEXT NOT NULL,
  rate   DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL              -- 'public' (Frankfurter / ECB)
);
SELECT create_hypertable('fx_rates', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS fx_rates_pair_time_idx ON fx_rates (base, quote, time DESC);
