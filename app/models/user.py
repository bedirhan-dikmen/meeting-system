import uuid
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    user_code = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String(20), default="user", nullable=False) # admin, user
    avatar_url = Column(String, nullable=True) # Profil Fotoğrafı URL
    
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)

    # İlişkiler
    department = relationship("Department", back_populates="users")
    meetings_created = relationship("Meeting", back_populates="creator")
    participations = relationship("MeetingParticipant", back_populates="user")
    sessions = relationship("ParticipantSession", back_populates="user")
    notifications = relationship("Notification", back_populates="user")