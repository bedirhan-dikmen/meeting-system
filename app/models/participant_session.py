# app/models/participant_session.py
from sqlalchemy import Column, Integer, ForeignKey, DateTime, func
from sqlalchemy.orm import relationship
from app.core.database import Base

class ParticipantSession(Base):
    __tablename__ = "participant_sessions"

    id = Column(Integer, primary_key=True, index=True)
    meeting_id = Column(Integer, ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    joined_at = Column(DateTime, default=func.now(), nullable=False)  # Odaya giriş anı [cite: 708]
    left_at = Column(DateTime, nullable=True)                         # Odadan çıkış anı [cite: 708]
    duration_seconds = Column(Integer, default=0, nullable=False)     # Oturum süresi [cite: 708]

    # İlişkiler (String tabanlı referans ile dairesel importların önüne geçiliyor)
    meeting = relationship("Meeting", back_populates="sessions")
    user = relationship("User", back_populates="sessions")