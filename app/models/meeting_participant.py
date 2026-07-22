import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base

class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    meeting_id = Column(UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, default="participant", nullable=False)  # moderator, participant
    status = Column(String, default="pending", nullable=False)  # pending, accepted, declined
    joined_at = Column(DateTime, nullable=True)
    invited_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


    # İlişkiler
    meeting = relationship("Meeting", back_populates="participants")
    user = relationship("User", back_populates="participations")