-- The original node protocol uses a separate opaque ticket. Existing internal
-- assignments retain their UUIDs and their PR21 settlement semantics.
ALTER TABLE fmworker_assignments ADD COLUMN protocol_ticket text
  CHECK (protocol_ticket IS NULL OR protocol_ticket ~ '^[A-Za-z0-9_-]{43}$');
