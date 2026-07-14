import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base

# 1. Departman Modeli
class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("User", back_populates="department")


# 2. Kullanıcı Modeli
class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    first_name = Column(String(50), nullable=False)
    last_name = Column(String(50), nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    user_code = Column(String(20), unique=True, index=True, nullable=True)  # Harici entegrasyon için
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="user")  # admin, user
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    department = relationship("Department", back_populates="users")
    owned_meetings = relationship("Meeting", back_populates="owner")


# 3. Toplantı Modeli (Microsoft Teams Oda Mantığı)
class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)  # Tahmin edilemez benzersiz oda linki
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    meeting_type = Column(String(30), default="project")  # daily, weekly, project
    status = Column(String(20), default="planned")  # draft, planned, active, completed, cancelled
    planned_start_at = Column(DateTime, nullable=False)
    planned_end_at = Column(DateTime, nullable=False)
    actual_start_at = Column(DateTime, nullable=True)
    actual_end_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="owned_meetings")
    participants = relationship("MeetingParticipant", back_populates="meeting", cascade="all, delete-orphan")
    sessions = relationship("ParticipantSession", back_populates="meeting")


# 4. Katılımcı Davet Ara Tablosu (Many-to-Many Bridge)
class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id = Column(UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    invite_status = Column(String(20), default="pending")  # pending, accepted, rejected
    joined_status = Column(String(20), default="not_joined")  # joined, not_joined
    invited_at = Column(DateTime, default=datetime.utcnow)

    meeting = relationship("Meeting", back_populates="participants")


# 5. Katılımcı Canlı Süre Loglama Tablosu (Teams Giriş/Çıkış Takibi)
class ParticipantSession(Base):
    __tablename__ = "participant_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id = Column(UUID(as_uuid=True), ForeignKey("meetings.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow)
    left_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, nullable=True)  # Odadan çıkınca hesaplanacak süre

    meeting = relationship("Meeting", back_populates="sessions")