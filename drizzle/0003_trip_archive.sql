-- Reversible owner-only removal; content and invitations remain intact.
ALTER TABLE itineraries ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS itineraries_owner_deleted ON itineraries(owner_email,deleted_at);
