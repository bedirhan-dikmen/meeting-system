# app/models/meeting.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Table, func
from sqlalchemy.orm import relationship
from app.core.database import Base

# Many-to-Many İlişki Tablosu (Toplantı Katılımcıları)
class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(150), nullable=False)
    description = Column(String(500), nullable=True)
    
    # Zaman ve Durum Yönetimi
    scheduled_start = Column(DateTime, nullable=False)
    scheduled_end = Column(DateTime, nullable=False)
    actual_start = Column(DateTime, nullable=True)
    actual_end = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    status = Column(String(50), default="scheduled")  # "scheduled", "ongoing", "completed", "cancelled"

    # Güvenlik ve WebRTC Erişim Bilgileri
    meeting_code = Column(String(100), unique=True, index=True, nullable=False)  # Benzersiz oda URL/Kodu
    api_key_secured = Column(Boolean, default=False)  # Dışarıdan API Key ile mi korunduğu bilgisi

    # Foreign Key: Toplantıyı düzenleyen/yöneten (Admin/Moderatör)
    organizer_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    created_at = Column(DateTime, default=func.now())

    # İlişkiler
    organizer = relationship("User", back_populates="organized_meetings")
    
    # Toplantıya ait tüm oturum logları
    sessions = relationship("ParticipantSession", back_populates="meeting", cascade="all, delete-orphan")
    
    # Katılımcılar Listesi (Many-to-Many)
    participants = relationship(
        "User",
        secondary= "meeting_participants",
        back_populates="meetings"
    )