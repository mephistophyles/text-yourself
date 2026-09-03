CREATE SEQUENCE sync_version_seq AS BIGINT;

CREATE TABLE topics (
    id UUID PRIMARY KEY,
    household_id UUID NOT NULL,
    created_by TEXT NOT NULL,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sync_version BIGINT NOT NULL DEFAULT nextval('sync_version_seq')
);

CREATE TABLE messages (
    id UUID PRIMARY KEY,
    household_id UUID NOT NULL,
    topic_id UUID NOT NULL REFERENCES topics(id),
    author_id TEXT NOT NULL,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
    voice_note_base64 TEXT,
    reply_to_id UUID REFERENCES messages(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    sync_version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    CHECK (reply_to_id IS NULL OR reply_to_id <> id)
);

CREATE OR REPLACE FUNCTION assign_sync_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Serialize version assignment through commit. A bare sequence can commit out
    -- of order and make an incremental client skip a late lower-numbered change.
    PERFORM pg_advisory_xact_lock(hashtext('text-yourself:sync-mutations'));
    NEW.sync_version := nextval('sync_version_seq');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER topics_assign_sync_version
BEFORE INSERT OR UPDATE ON topics
FOR EACH ROW EXECUTE FUNCTION assign_sync_version();

CREATE TRIGGER messages_assign_sync_version
BEFORE INSERT OR UPDATE ON messages
FOR EACH ROW EXECUTE FUNCTION assign_sync_version();

CREATE OR REPLACE FUNCTION validate_message_reply() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    parent_topic_id UUID;
    parent_household_id UUID;
BEGIN
    IF NEW.reply_to_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT topic_id, household_id
      INTO parent_topic_id, parent_household_id
      FROM messages
     WHERE id = NEW.reply_to_id;
    IF NOT FOUND OR parent_topic_id <> NEW.topic_id OR parent_household_id <> NEW.household_id THEN
        RAISE EXCEPTION 'reply target must be in the same topic and household'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER messages_validate_reply
BEFORE INSERT OR UPDATE OF reply_to_id, topic_id, household_id ON messages
FOR EACH ROW EXECUTE FUNCTION validate_message_reply();

CREATE INDEX topics_household_updated_idx
    ON topics (household_id, updated_at DESC, id DESC);
CREATE INDEX topics_household_sync_idx
    ON topics (household_id, sync_version);
CREATE INDEX topics_search_idx
    ON topics USING GIN (to_tsvector('simple', title));
CREATE INDEX messages_topic_created_idx
    ON messages (household_id, topic_id, created_at, id);
CREATE INDEX messages_household_sync_idx
    ON messages (household_id, sync_version);
CREATE INDEX messages_search_idx
    ON messages USING GIN (to_tsvector('simple', body))
    WHERE deleted_at IS NULL;

ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics FORCE ROW LEVEL SECURITY;
CREATE POLICY topics_household_access ON topics
    USING (household_id = nullif(current_setting('app.household_id', true), '')::uuid)
    WITH CHECK (household_id = nullif(current_setting('app.household_id', true), '')::uuid);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY messages_household_access ON messages
    USING (household_id = nullif(current_setting('app.household_id', true), '')::uuid)
    WITH CHECK (household_id = nullif(current_setting('app.household_id', true), '')::uuid);
