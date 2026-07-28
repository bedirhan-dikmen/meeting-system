import uuid
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from sqlalchemy import String, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from app.core.database import Base

from app.core.tz import get_tr_now

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.meeting_participant import MeetingParticipant
    from app.models.participant_session import ParticipantSession
    from app.models.meeting_note import MeetingNote
    from app.models.meeting_action import MeetingAction

class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    scheduled_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    scheduled_end: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    actual_start: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    actual_end: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    meeting_code: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)  # WebRTC / Oda erişim kodu
    meeting_type: Mapped[str] = mapped_column(String, default="Genel Toplantı", nullable=False) # günlük, haftalık, proje, vb.
    agenda: Mapped[Optional[str]] = mapped_column(Text, nullable=True) # toplantı gündemi
    status: Mapped[str] = mapped_column(String, default="planlandı", nullable=False) # taslak, planlandı, başladı, tamamlandı, iptal edildi
    passcode: Mapped[Optional[str]] = mapped_column(String(50), nullable=True) # Oda şifresi
    lobby_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False) # Bekleme odası / Lobi
    is_private: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False) # Sadece davetliler
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_tr_now, nullable=False)

    # Yabancı Anahtar (Yalnızca bir kez tanımlandı)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # İlişkiler
    creator: Mapped["User"] = relationship("User", back_populates="meetings_created")
    participants: Mapped[list["MeetingParticipant"]] = relationship("MeetingParticipant", back_populates="meeting", cascade="all, delete-orphan")
    sessions: Mapped[list["ParticipantSession"]] = relationship("ParticipantSession", back_populates="meeting", cascade="all, delete-orphan")
    notes: Mapped[list["MeetingNote"]] = relationship("MeetingNote", back_populates="meeting", cascade="all, delete-orphan")
    actions: Mapped[list["MeetingAction"]] = relationship("MeetingAction", back_populates="meeting", cascade="all, delete-orphan")