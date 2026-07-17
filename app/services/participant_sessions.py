from sqlalchemy import select
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime
from typing import List, Optional
from app.models.participant_session import ParticipantSession

def create_session(db: Session, meeting_id: UUID, user_id: UUID) -> ParticipantSession:
    """Katılımcı odaya bağlandığında yeni bir canlı oturum (giriş logu) başlatır."""
    db_session = ParticipantSession(
        meeting_id=meeting_id,
        user_id=user_id,
        joined_at=datetime.utcnow()
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return db_session

def close_session(db: Session, session_id: UUID) -> Optional[ParticipantSession]:
    """Katılımcı odadan ayrıldığında oturumu kapatır ve aktif kaldığı süreyi dakika cinsinden hesaplar."""
    db_session = db.get(ParticipantSession, session_id)
    if not db_session:
        return None
    
    db_session.left_at = datetime.utcnow()
    
    # Süre hesaplama (Dakika bazında)
    if db_session.joined_at:
        duration = db_session.left_at - db_session.joined_at
        db_session.duration_minutes = round(duration.total_seconds() / 60.0, 2)
        
    db.commit()
    db.refresh(db_session)
    return db_session

def get_meeting_sessions(db: Session, meeting_id: UUID) -> List[ParticipantSession]:
    """Bir toplantıya ait tüm katılım oturum geçmişini listeler."""
    stmt = select(ParticipantSession).where(ParticipantSession.meeting_id == meeting_id)
    return list(db.scalars(stmt).all())