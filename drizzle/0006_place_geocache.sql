-- Only hashes and provider results are stored; no emails, itinerary payloads,
-- booking references, or raw search strings. All timestamps are UTC milliseconds.
CREATE TABLE place_geocode_cache (
 query_hash TEXT PRIMARY KEY NOT NULL,
 result TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX place_geocode_cache_expiry ON place_geocode_cache(expires_at);
CREATE TABLE place_geocode_rate (
 id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
 day INTEGER NOT NULL,
 requests INTEGER NOT NULL,
 next_request_at INTEGER NOT NULL
);
