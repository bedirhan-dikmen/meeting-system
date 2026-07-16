# app/models/user.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from app.core.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(150), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    user_code = Column(String(50), unique=True, index=True, nullable=True)  # Harici sistem entegrasyonu için
    role = Column(String(50), default="user", nullable=False)  # "admin", "moderator", "user"
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())

    # Foreign Key: Departman ilişkisi
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)

    # İlişkiler
    department = relationship("Department", back_populates="users")
    
    # Oluşturduğu toplantılar (Bir kullanıcı birden fazla toplantı organize edebilir)
    organized_meetings = relationship("Meeting", back_populates="organizer")

    # Katıldığı toplantılar (Many-to-Many ilişki - ara tablo "meeting_participants" üzerinden bağlanır)
    meetings = relationship(
        "Meeting",
        secondary="meeting_participants",
        back_populates="participants"
    )
    # Canlı katılım oturum detayları
    sessions = relationship("ParticipantSession", back_populates="user", cascade="all, delete-orphan")