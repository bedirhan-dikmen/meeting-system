from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List
from app.core.database import get_db
from app.core.security import get_current_user  # Kendi security dosyanızdaki isimle eşleyin
from app.models.user import User
from app.schemas.participant_sessions import ParticipantSessionOut
from app.services import participant_sessions as session_service

router = APIRouter(prefix="/sessions", tags=["Toplantı Oturumları"])

@router.post("/start", response_model=ParticipantSessionOut, status_code=status.HTTP_201_CREATED)
def start_user_session(
    meeting_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Katılımcı toplantıya bağlandığında yeni bir canlı oturum logu açar."""
    return session_service.create_session(db, meeting_id=meeting_id, user_id=user_id)

@router.put("/{session_id}/close", response_model=ParticipantSessionOut)
def close_user_session(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Katılımcı toplantıdan ayrıldığında oturumu kapatır ve süreyi kaydeder."""
    session = session_service.close_session(db, session_id=session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Oturum bulunamadı.")
    return session

@router.get("/meeting/{meeting_id}", response_model=List[ParticipantSessionOut])
def read_meeting_sessions(
    meeting_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Toplantıya katılan tüm kullanıcıların oturum kayıtlarını listeler."""
    return session_service.get_meeting_sessions(db, meeting_id=meeting_id)