# app/models/meeting_participant.py
from sqlalchemy import Column, Integer, ForeignKey, DateTime, Table
from app.core.database import Base

# Many-to-Many İlişki Tablosu (Toplantı Katılımcıları)
meeting_participants = Table(
    "meeting_participants",
    Base.metadata,
    Column("meeting_id", Integer, ForeignKey("meetings.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("joined_at", DateTime, nullable=True),  # Toplantıya ilk giriş zamanı
    Column("left_at", DateTime, nullable=True),    # Toplantıdan son çıkış zamanı
    Column("duration_seconds", Integer, default=0) # Saniyeler bazında aktif kalma süresi
)