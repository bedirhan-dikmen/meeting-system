import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum as SQLEnum, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.enums import InvitationStatus, AttendanceStatus

class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    meeting_id = Column(UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    role = Column(String, default="participant", nullable=False)  # host, moderator, participant
    invitation_status = Column(SQLEnum(InvitationStatus), default=InvitationStatus.PENDING, nullable=False)
    attendance_status = Column(SQLEnum(AttendanceStatus), default=AttendanceStatus.NOT_ATTENDED, nullable=False)
    
    invited_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    joined_at = Column(DateTime, nullable=True)
    
    join_count = Column(Integer, default=0, nullable=False)  # Kaç kez odaya giriş yaptığı
    total_duration_seconds = Column(Integer, default=0, nullable=False) # Toplam süresi

    # İlişkiler
    meeting = relationship("Meeting", back_populates="participants")
    user = relationship("User", back_populates="participations")