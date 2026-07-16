import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base

class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    title = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    scheduled_start = Column(DateTime, nullable=False)
    scheduled_end = Column(DateTime, nullable=False)
    actual_start = Column(DateTime, nullable=True)
    actual_end = Column(DateTime, nullable=True)
    meeting_code = Column(String, unique=True, index=True, nullable=False)  # WebRTC / Oda erişim kodu
    is_active = Column(Boolean, default=True, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Yabancı Anahtar
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # İlişkiler
    creator = relationship("User", back_populates="meetings_created")
    participants = relationship("MeetingParticipant", back_populates="meeting", cascade="all, delete-orphan")
    sessions = relationship("ParticipantSession", back_populates="meeting", cascade="all, delete-orphan")
    notes = relationship("MeetingNote", back_populates="meeting", cascade="all, delete-orphan")
    actions = relationship("MeetingAction", back_populates="meeting", cascade="all, delete-orphan")