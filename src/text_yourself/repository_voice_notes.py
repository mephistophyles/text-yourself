from __future__ import annotations

from uuid import UUID

from .identity import Identity
from .repository_base import Record, RepositoryBase
from .repository_records import message_columns


class VoiceNoteRepository(RepositoryBase):
    async def attach_voice_note(
        self,
        identity: Identity,
        message_id: UUID,
        mime_type: str,
        audio: bytes,
    ) -> tuple[Record | None, bool]:
        """Store audio for a message. Returns the message row and whether it was new.

        Idempotent so a retried upload from the client outbox is harmless: a
        second upload for the same message keeps the first recording.
        """
        async with self._database.transaction(identity) as connection:
            cursor = await connection.execute(
                """
                INSERT INTO voice_notes
                    (message_id, household_id, author_id, mime_type, byte_size, audio)
                SELECT id, %s, %s, %s, %s, %s
                  FROM messages
                 WHERE id = %s AND author_id = %s AND deleted_at IS NULL
                ON CONFLICT (message_id) DO NOTHING
                RETURNING message_id
                """,
                (
                    self._database.household_id,
                    identity.user_id,
                    mime_type,
                    len(audio),
                    audio,
                    message_id,
                    identity.user_id,
                ),
            )
            created = await cursor.fetchone() is not None
            if created:
                await connection.execute(
                    "UPDATE messages SET has_voice_note = true WHERE id = %s AND NOT has_voice_note",
                    (message_id,),
                )
            result = await connection.execute(
                f"SELECT {message_columns()} FROM messages WHERE id = %s", (message_id,)
            )
            return await result.fetchone(), created

    async def voice_note(self, identity: Identity, message_id: UUID) -> Record | None:
        """Return the stored audio, or None when the message has none or is deleted."""
        async with self._database.transaction(identity) as connection:
            cursor = await connection.execute(
                """
                SELECT voice_notes.mime_type, voice_notes.byte_size, voice_notes.audio
                  FROM voice_notes
                  JOIN messages ON messages.id = voice_notes.message_id
                 WHERE voice_notes.message_id = %s AND messages.deleted_at IS NULL
                """,
                (message_id,),
            )
            return await cursor.fetchone()
