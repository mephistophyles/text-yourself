DROP TABLE IF EXISTS voice_notes;

-- Messages that only ever held a voice note have no body to restore, so the
-- minimum-length check cannot come back while they exist. Drop them first;
-- the audio they referenced is already gone with voice_notes above.
DELETE FROM messages WHERE has_voice_note AND char_length(body) < 1;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_body_valid;
ALTER TABLE messages ADD CONSTRAINT messages_body_check
    CHECK (char_length(body) BETWEEN 1 AND 20000);
ALTER TABLE messages DROP COLUMN IF EXISTS has_voice_note;
