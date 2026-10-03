-- Additive migration: retain the old tables as a recoverable snapshot.
CREATE TABLE IF NOT EXISTS itineraries (
 id TEXT PRIMARY KEY NOT NULL,
 owner_email TEXT NOT NULL,
 title TEXT NOT NULL,
 start_date TEXT NOT NULL,
 end_date TEXT NOT NULL,
 timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
 payload TEXT NOT NULL,
 previous TEXT,
 revision INTEGER NOT NULL DEFAULT 0,
 mutation_id TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS itinerary_members (
 trip_id TEXT NOT NULL REFERENCES itineraries(id),
 email TEXT NOT NULL,
 role TEXT NOT NULL CHECK (role IN ('viewer','editor')),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
 updated_at TEXT NOT NULL,
 PRIMARY KEY (trip_id,email)
);
CREATE INDEX IF NOT EXISTS itineraries_owner ON itineraries(owner_email);
CREATE INDEX IF NOT EXISTS itinerary_members_email ON itinerary_members(email,enabled);
CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY NOT NULL);
-- Copy only when the new Worker serves its first authenticated API request.
-- Its D1 batch snapshots the latest old data and installs the marker atomically.
-- A late in-flight request from the old Worker then cannot write an untracked
-- edit into the recovery tables after that snapshot.
CREATE TRIGGER IF NOT EXISTS legacy_trip_insert_guard BEFORE INSERT ON trips
 WHEN EXISTS (SELECT 1 FROM app_migrations WHERE name='legacy-members-v1')
 BEGIN SELECT RAISE(ABORT,'Legacy storage is read-only after multi-trip migration'); END;
CREATE TRIGGER IF NOT EXISTS legacy_trip_update_guard BEFORE UPDATE ON trips
 WHEN EXISTS (SELECT 1 FROM app_migrations WHERE name='legacy-members-v1')
 BEGIN SELECT RAISE(ABORT,'Legacy storage is read-only after multi-trip migration'); END;
CREATE TRIGGER IF NOT EXISTS legacy_trip_delete_guard BEFORE DELETE ON trips
 WHEN EXISTS (SELECT 1 FROM app_migrations WHERE name='legacy-members-v1')
 BEGIN SELECT RAISE(ABORT,'Legacy storage is read-only after multi-trip migration'); END;
CREATE TRIGGER IF NOT EXISTS legacy_member_insert_guard BEFORE INSERT ON trip_members
 WHEN EXISTS (SELECT 1 FROM app_migrations WHERE name='legacy-members-v1')
 BEGIN SELECT RAISE(ABORT,'Legacy storage is read-only after multi-trip migration'); END;
CREATE TRIGGER IF NOT EXISTS legacy_member_update_guard BEFORE UPDATE ON trip_members
 WHEN EXISTS (SELECT 1 FROM app_migrations WHERE name='legacy-members-v1')
 BEGIN SELECT RAISE(ABORT,'Legacy storage is read-only after multi-trip migration'); END;
CREATE TRIGGER IF NOT EXISTS legacy_member_delete_guard BEFORE DELETE ON trip_members
 WHEN EXISTS (SELECT 1 FROM app_migrations WHERE name='legacy-members-v1')
 BEGIN SELECT RAISE(ABORT,'Legacy storage is read-only after multi-trip migration'); END;
