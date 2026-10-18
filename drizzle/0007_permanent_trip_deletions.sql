-- Add guards only. Existing archived trips are deliberately not purged here.
-- Tombstones hold identifiers, never itinerary contents or invitation details.
CREATE TABLE IF NOT EXISTS deleted_itineraries (
 id TEXT PRIMARY KEY NOT NULL,
 owner_email TEXT NOT NULL,
 revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deleted_stops (
 trip_id TEXT NOT NULL REFERENCES itineraries(id),
 stop_id TEXT NOT NULL,
 PRIMARY KEY (trip_id,stop_id)
);
-- The legacy recovery tables are normally immutable. Only a successful purge
-- of that exact migrated trip may erase its matching old content/invitations.
DROP TRIGGER IF EXISTS legacy_trip_delete_guard;
CREATE TRIGGER legacy_trip_delete_guard BEFORE DELETE ON trips
 WHEN EXISTS (SELECT 1 FROM app_migrations WHERE name='legacy-members-v1')
 AND NOT EXISTS (SELECT 1 FROM deleted_itineraries WHERE id='legacy-hokkaido-2026' AND owner_email=lower(OLD.user_id))
 BEGIN SELECT RAISE(ABORT,'Legacy storage is read-only after multi-trip migration'); END;
DROP TRIGGER IF EXISTS legacy_member_delete_guard;
CREATE TRIGGER legacy_member_delete_guard BEFORE DELETE ON trip_members
 WHEN EXISTS (SELECT 1 FROM app_migrations WHERE name='legacy-members-v1')
 AND NOT EXISTS (SELECT 1 FROM deleted_itineraries WHERE id='legacy-hokkaido-2026')
 BEGIN SELECT RAISE(ABORT,'Legacy storage is read-only after multi-trip migration'); END;
CREATE TRIGGER IF NOT EXISTS permanent_trip_insert_guard BEFORE INSERT ON itineraries
 WHEN EXISTS (SELECT 1 FROM deleted_itineraries WHERE id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'Permanently deleted trip cannot be recreated'); END;
-- These foreign keys do not cascade in the original schema. The trigger and
-- parent DELETE share one transaction, including the owner's revision check.
CREATE TRIGGER IF NOT EXISTS permanent_trip_purge BEFORE DELETE ON itineraries
 BEGIN
  INSERT OR IGNORE INTO deleted_itineraries (id,owner_email,revision) VALUES (OLD.id,OLD.owner_email,OLD.revision);
  DELETE FROM itinerary_members WHERE trip_id=OLD.id;
  DELETE FROM stop_creators WHERE trip_id=OLD.id;
  DELETE FROM deleted_stops WHERE trip_id=OLD.id;
  DELETE FROM trips WHERE OLD.id='legacy-hokkaido-2026' AND lower(user_id)=OLD.owner_email;
  DELETE FROM trip_members WHERE OLD.id='legacy-hokkaido-2026';
 END;
CREATE TRIGGER IF NOT EXISTS permanent_stop_update_guard BEFORE UPDATE OF payload ON itineraries
 WHEN EXISTS (
  SELECT 1 FROM deleted_stops tombstone
  JOIN json_each(NEW.payload) day ON 1=1
  JOIN json_each(json_extract(day.value,'$.stops')) stop ON 1=1
  WHERE tombstone.trip_id=NEW.id AND tombstone.stop_id=COALESCE(json_extract(stop.value,'$.id'),'legacy-'||day.key||'-'||stop.key)
 )
 BEGIN SELECT RAISE(ABORT,'Permanently deleted stop cannot be restored'); END;
