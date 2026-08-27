DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS topics;
DROP FUNCTION IF EXISTS validate_message_reply();
DROP FUNCTION IF EXISTS assign_sync_version();
DROP SEQUENCE IF EXISTS sync_version_seq;
