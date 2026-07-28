import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from app.core.database import Base

from app.core.tz import get_tr_now

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    first_name: Mapped[str] = mapped_column(String, nullable=False)
    last_name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    user_code: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="user", nullable=False) # Çift alan teke düşürüldü
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True) # Profil fotoğrafı static URL
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_tr_now, nullable=False)



    # Yabancı Anahtar
    department_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)

    # İLİŞKİLER (back_populates simetrisi düzeltildi)
    department = relationship("Department", back_populates="users")
    participations = relationship("MeetingParticipant", back_populates="user")
    sessions = relationship("ParticipantSession", back_populates="user")
    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")
    meetings_created = relationship("Meeting", back_populates="creator")