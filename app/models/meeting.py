import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean, Enum as SQLEnum, Date
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.enums import MeetingType, MeetingStatus

class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    title = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    agenda = Column(Text, nullable=True)  # Toplantı Gündemi
    
    meeting_date = Column(Date, nullable=True, default=datetime.utcnow().date)
    scheduled_start = Column(DateTime, nullable=False)
    scheduled_end = Column(DateTime, nullable=False)
    actual_start = Column(DateTime, nullable=True)  # Gerçek Başlangıç
    actual_end = Column(DateTime, nullable=True)    # Gerçek Bitiş
    
    meeting_type = Column(SQLEnum(MeetingType), default=MeetingType.GENERAL, nullable=False)
    status = Column(SQLEnum(MeetingStatus), default=MeetingStatus.SCHEDULED, nullable=False)
    
    meeting_code = Column(String, unique=True, index=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # İlişkiler (actions ilişkisi eklendi!)
    creator = relationship("User", back_populates="meetings_created")
    participants = relationship("MeetingParticipant", back_populates="meeting", cascade="all, delete-orphan")
    sessions = relationship("ParticipantSession", back_populates="meeting", cascade="all, delete-orphan")
    notes = relationship("MeetingNote", back_populates="meeting", cascade="all, delete-orphan")
    actions = relationship("MeetingAction", back_populates="meeting", cascade="all, delete-orphan")