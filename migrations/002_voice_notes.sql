-- Voice notes live in their own table so audio never rides the sync channel.
-- messages.has_voice_note is the only part that syncs; the bytes are fetched
-- on demand from /api/messages/{id}/voice-note.

ALTER TABLE messages ADD COLUMN has_voice_note BOOLEAN NOT NULL DEFAULT false;

-- A voice note can stand on its own, so the body may be empty when one is
-- attached. Replaces the length check from 001 with a name we control.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_body_check;
ALTER TABLE messages ADD CONSTRAINT messages_body_valid
    CHECK (char_length(body) <= 20000 AND (char_length(body) >= 1 OR has_voice_note));

-- The DROP above relies on PostgreSQL's default constraint name. If 001 was
-- applied under a different name the old minimum-length check would survive
-- and voice-only messages would fail at runtime, so fail the deploy here.
DO $$
DECLARE leftover TEXT;
BEGIN
    SELECT string_agg(conname, ', ') INTO leftover
      FROM pg_constraint
     WHERE conrelid = 'messages'::regclass
       AND contype = 'c'
       AND conname <> 'messages_body_valid'
       AND pg_get_constraintdef(oid) ILIKE '%char_length(body)%';
    IF leftover IS NOT NULL THEN
        RAISE EXCEPTION 'unexpected body length constraint(s) remain on messages: %', leftover;
    END IF;
END $$;

CREATE TABLE voice_notes (
    message_id UUID PRIMARY KEY REFERENCES messages(id),
    household_id UUID NOT NULL,
    author_id TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('audio/webm', 'audio/ogg', 'audio/mp4')),
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 8000000),
    audio BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE voice_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY voice_notes_household_access ON voice_notes
    USING (household_id = nullif(current_setting('app.household_id', true), '')::uuid)
    WITH CHECK (household_id = nullif(current_setting('app.household_id', true), '')::uuid);
