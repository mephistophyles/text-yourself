from __future__ import annotations

from .repository_messages import MessageRepository
from .repository_queries import QueryRepository
from .repository_topics import TopicRepository
from .repository_voice_notes import VoiceNoteRepository


class PostgresRepository(TopicRepository, MessageRepository, QueryRepository, VoiceNoteRepository):
    """Composes focused PostgreSQL repositories behind one service boundary."""
