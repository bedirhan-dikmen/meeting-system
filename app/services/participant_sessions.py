from sqlalchemy import select
from sqlalchemy.orm import Session
from uuid import UUID, uuid4
from datetime import datetime
from typing import List, Optional
from app.models.participant_session import ParticipantSession

def create_session(db: Session, meeting_id: UUID, user_id: UUID) -> ParticipantSession:
    db_session = ParticipantSession(
        id=uuid4(),
        meeting_id=meeting_id,
        user_id=user_id,
        joined_at=datetime.utcnow(),
        left_at=None,
        duration_seconds=0
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return db_session

def close_session(db: Session, session_id: UUID) -> ParticipantSession:
    session = db.get(ParticipantSession, session_id)
    if not session or session.left_at:
        return session
        
    session.left_at = datetime.utcnow()
    delta = session.left_at - session.joined_at
    session.duration_seconds = max(int(delta.total_seconds()), 0)
    
    db.commit()
    db.refresh(session)
    return session

def get_meeting_sessions(db: Session, meeting_id: UUID) -> List[ParticipantSession]:
    """Bir toplantıya ait tüm katılım oturum geçmişini listeler."""
    stmt = select(ParticipantSession).where(ParticipantSession.meeting_id == meeting_id)
    return list(db.scalars(stmt).all())