-- Immutable per-trip creator history. NULL means a known stop whose creator
-- cannot be established, including legacy stops. Removal never removes this
-- record, so old drafts and undo cannot reassign authorship later.
CREATE TABLE IF NOT EXISTS stop_creators (
 trip_id TEXT NOT NULL REFERENCES itineraries(id),
 stop_id TEXT NOT NULL,
 created_by TEXT,
 PRIMARY KEY (trip_id,stop_id)
);
-- Prefer reliable current attribution, then previous attribution, before NULL.
INSERT OR IGNORE INTO stop_creators (trip_id,stop_id,created_by)
 SELECT trip_id,stop_id,CASE WHEN typeof(raw_creator)='text' AND length(trim(raw_creator)) BETWEEN 3 AND 254 AND trim(raw_creator) LIKE '%_@_%._%' AND length(trim(raw_creator))-length(replace(trim(raw_creator),'@',''))=1 AND instr(trim(raw_creator),char(9))=0 AND instr(trim(raw_creator),char(10))=0 AND instr(trim(raw_creator),char(11))=0 AND instr(trim(raw_creator),char(12))=0 AND instr(trim(raw_creator),char(13))=0 AND instr(trim(raw_creator),char(32))=0 AND instr(trim(raw_creator),char(160))=0 AND instr(trim(raw_creator),char(5760))=0 AND instr(trim(raw_creator),char(8192))=0 AND instr(trim(raw_creator),char(8193))=0 AND instr(trim(raw_creator),char(8194))=0 AND instr(trim(raw_creator),char(8195))=0 AND instr(trim(raw_creator),char(8196))=0 AND instr(trim(raw_creator),char(8197))=0 AND instr(trim(raw_creator),char(8198))=0 AND instr(trim(raw_creator),char(8199))=0 AND instr(trim(raw_creator),char(8200))=0 AND instr(trim(raw_creator),char(8201))=0 AND instr(trim(raw_creator),char(8202))=0 AND instr(trim(raw_creator),char(8232))=0 AND instr(trim(raw_creator),char(8233))=0 AND instr(trim(raw_creator),char(8239))=0 AND instr(trim(raw_creator),char(8287))=0 AND instr(trim(raw_creator),char(12288))=0 AND instr(trim(raw_creator),char(65279))=0 THEN lower(trim(raw_creator)) ELSE NULL END AS created_by
 FROM (
  SELECT source.trip_id,source.priority,
   COALESCE(json_extract(stop.value,'$.id'),'legacy-'||day.key||'-'||stop.key) AS stop_id,
   CASE WHEN json_type(stop.value,'$.createdBy')='text' THEN json_extract(stop.value,'$.createdBy') ELSE NULL END AS raw_creator
  FROM (SELECT id AS trip_id,payload,0 AS priority FROM itineraries UNION ALL SELECT id AS trip_id,previous AS payload,1 AS priority FROM itineraries) AS source
  JOIN json_each(CASE WHEN json_valid(source.payload) THEN source.payload ELSE '[]' END) AS day ON 1=1
  JOIN json_each(CASE WHEN json_valid(day.value) THEN CASE WHEN json_type(day.value)='object' AND json_type(day.value,'$.stops')='array' THEN json_extract(day.value,'$.stops') ELSE '[]' END ELSE '[]' END) AS stop ON 1=1
  WHERE CASE WHEN json_valid(stop.value) THEN json_type(stop.value)='object' ELSE 0 END
 )
 WHERE typeof(stop_id)='text' AND length(stop_id) BETWEEN 1 AND 80 AND stop_id NOT GLOB '*[^a-zA-Z0-9_-]*'
 ORDER BY created_by IS NULL,priority;
-- Attribution is recorded by the same successful storage statement. Failed CAS
-- and failed trigger transactions cannot produce orphan creator records.
CREATE TRIGGER IF NOT EXISTS stop_creators_after_insert AFTER INSERT ON itineraries
BEGIN
INSERT OR IGNORE INTO stop_creators (trip_id,stop_id,created_by)
 SELECT trip_id,stop_id,CASE WHEN typeof(raw_creator)='text' AND length(trim(raw_creator)) BETWEEN 3 AND 254 AND trim(raw_creator) LIKE '%_@_%._%' AND length(trim(raw_creator))-length(replace(trim(raw_creator),'@',''))=1 AND instr(trim(raw_creator),char(9))=0 AND instr(trim(raw_creator),char(10))=0 AND instr(trim(raw_creator),char(11))=0 AND instr(trim(raw_creator),char(12))=0 AND instr(trim(raw_creator),char(13))=0 AND instr(trim(raw_creator),char(32))=0 AND instr(trim(raw_creator),char(160))=0 AND instr(trim(raw_creator),char(5760))=0 AND instr(trim(raw_creator),char(8192))=0 AND instr(trim(raw_creator),char(8193))=0 AND instr(trim(raw_creator),char(8194))=0 AND instr(trim(raw_creator),char(8195))=0 AND instr(trim(raw_creator),char(8196))=0 AND instr(trim(raw_creator),char(8197))=0 AND instr(trim(raw_creator),char(8198))=0 AND instr(trim(raw_creator),char(8199))=0 AND instr(trim(raw_creator),char(8200))=0 AND instr(trim(raw_creator),char(8201))=0 AND instr(trim(raw_creator),char(8202))=0 AND instr(trim(raw_creator),char(8232))=0 AND instr(trim(raw_creator),char(8233))=0 AND instr(trim(raw_creator),char(8239))=0 AND instr(trim(raw_creator),char(8287))=0 AND instr(trim(raw_creator),char(12288))=0 AND instr(trim(raw_creator),char(65279))=0 THEN lower(trim(raw_creator)) ELSE NULL END AS created_by
 FROM (
  SELECT source.trip_id,source.priority,
   COALESCE(json_extract(stop.value,'$.id'),'legacy-'||day.key||'-'||stop.key) AS stop_id,
   CASE WHEN json_type(stop.value,'$.createdBy')='text' THEN json_extract(stop.value,'$.createdBy') ELSE NULL END AS raw_creator
  FROM (SELECT NEW.id AS trip_id,NEW.payload AS payload,0 AS priority UNION ALL SELECT NEW.id AS trip_id,NEW.previous AS payload,1 AS priority) AS source
  JOIN json_each(CASE WHEN json_valid(source.payload) THEN source.payload ELSE '[]' END) AS day ON 1=1
  JOIN json_each(CASE WHEN json_valid(day.value) THEN CASE WHEN json_type(day.value)='object' AND json_type(day.value,'$.stops')='array' THEN json_extract(day.value,'$.stops') ELSE '[]' END ELSE '[]' END) AS stop ON 1=1
  WHERE CASE WHEN json_valid(stop.value) THEN json_type(stop.value)='object' ELSE 0 END
 )
 WHERE typeof(stop_id)='text' AND length(stop_id) BETWEEN 1 AND 80 AND stop_id NOT GLOB '*[^a-zA-Z0-9_-]*'
 ORDER BY created_by IS NULL,priority;
END;
CREATE TRIGGER IF NOT EXISTS stop_creators_after_payload_update AFTER UPDATE OF payload ON itineraries
BEGIN
INSERT OR IGNORE INTO stop_creators (trip_id,stop_id,created_by)
 SELECT trip_id,stop_id,CASE WHEN typeof(raw_creator)='text' AND length(trim(raw_creator)) BETWEEN 3 AND 254 AND trim(raw_creator) LIKE '%_@_%._%' AND length(trim(raw_creator))-length(replace(trim(raw_creator),'@',''))=1 AND instr(trim(raw_creator),char(9))=0 AND instr(trim(raw_creator),char(10))=0 AND instr(trim(raw_creator),char(11))=0 AND instr(trim(raw_creator),char(12))=0 AND instr(trim(raw_creator),char(13))=0 AND instr(trim(raw_creator),char(32))=0 AND instr(trim(raw_creator),char(160))=0 AND instr(trim(raw_creator),char(5760))=0 AND instr(trim(raw_creator),char(8192))=0 AND instr(trim(raw_creator),char(8193))=0 AND instr(trim(raw_creator),char(8194))=0 AND instr(trim(raw_creator),char(8195))=0 AND instr(trim(raw_creator),char(8196))=0 AND instr(trim(raw_creator),char(8197))=0 AND instr(trim(raw_creator),char(8198))=0 AND instr(trim(raw_creator),char(8199))=0 AND instr(trim(raw_creator),char(8200))=0 AND instr(trim(raw_creator),char(8201))=0 AND instr(trim(raw_creator),char(8202))=0 AND instr(trim(raw_creator),char(8232))=0 AND instr(trim(raw_creator),char(8233))=0 AND instr(trim(raw_creator),char(8239))=0 AND instr(trim(raw_creator),char(8287))=0 AND instr(trim(raw_creator),char(12288))=0 AND instr(trim(raw_creator),char(65279))=0 THEN lower(trim(raw_creator)) ELSE NULL END AS created_by
 FROM (
  SELECT source.trip_id,source.priority,
   COALESCE(json_extract(stop.value,'$.id'),'legacy-'||day.key||'-'||stop.key) AS stop_id,
   CASE WHEN json_type(stop.value,'$.createdBy')='text' THEN json_extract(stop.value,'$.createdBy') ELSE NULL END AS raw_creator
  FROM (SELECT NEW.id AS trip_id,NEW.payload AS payload,0 AS priority UNION ALL SELECT NEW.id AS trip_id,NEW.previous AS payload,1 AS priority) AS source
  JOIN json_each(CASE WHEN json_valid(source.payload) THEN source.payload ELSE '[]' END) AS day ON 1=1
  JOIN json_each(CASE WHEN json_valid(day.value) THEN CASE WHEN json_type(day.value)='object' AND json_type(day.value,'$.stops')='array' THEN json_extract(day.value,'$.stops') ELSE '[]' END ELSE '[]' END) AS stop ON 1=1
  WHERE CASE WHEN json_valid(stop.value) THEN json_type(stop.value)='object' ELSE 0 END
 )
 WHERE typeof(stop_id)='text' AND length(stop_id) BETWEEN 1 AND 80 AND stop_id NOT GLOB '*[^a-zA-Z0-9_-]*'
 ORDER BY created_by IS NULL,priority;
END;
