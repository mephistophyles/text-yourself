from __future__ import annotations

from .repository_messages import MessageRepository
from .repository_queries import QueryRepository
from .repository_topics import TopicRepository


class PostgresRepository(TopicRepository, MessageRepository, QueryRepository):
    """Composes focused PostgreSQL repositories behind one service boundary."""
