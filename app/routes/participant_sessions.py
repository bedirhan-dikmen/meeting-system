# app/routes/participant_sessions.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID, uuid4
from typing import List
from datetime import datetime

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.participant_session import ParticipantSession
from app.models.meeting_participant import MeetingParticipant
from app.schemas.participant_sessions import ParticipantSessionOut

router = APIRouter(prefix="/sessions", tags=["Toplantı Canlı Oturum Takibi"])

@router.post("/start", response_model=dict, status_code=status.HTTP_201_CREATED)
def start_user_session(
    meeting_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: any = Depends(get_current_user)
):
    """
    Katılımcı odaya ilk kez girdiğinde veya kopup tekrar bağlandığında 
    yeni bir canlı oturum (Session) logu açar. Önceki kayıtları korur.
    """
    new_session = ParticipantSession(
        id=uuid4(),
        meeting_id=meeting_id,
        user_id=user_id,
        joined_at=datetime.utcnow(),
        left_at=None,
        duration_seconds=0
    )
    db.add(new_session)
    
    # Katılımcı ana özet tablosundaki katılım durumunu güncelle
    participant = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting_id,
        MeetingParticipant.user_id == user_id
    ).first()
    
    if participant:
        if not participant.joined_at:
            participant.joined_at = datetime.utcnow()
        # İleride eklenebilecek join_count veya kümülatif alanlar için kanca bırakıldı
    
    db.commit()
    return {"status": "success", "session_id": str(new_session.id)}

@router.put("/{session_id}/close", response_model=dict)
def close_user_session(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: any = Depends(get_current_user)
):
    """
    Katılımcı odadan ayrıldığında veya tarayıcı sekmesini kapattığında 
    oturumu kapatır, kalınan süreyi saniye tabanlı hesaplayarak mühürler.
    """
    session = db.get(ParticipantSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Aktif oturum kaydı bulunamadı.")
        
    if session.left_at is not None:
        return {"status": "already_closed", "duration_seconds": session.duration_seconds}
        
    session.left_at = datetime.utcnow()
    
    # Giriş ve çıkış arasındaki farkı tam sayı saniye olarak hesaplama (Mühendislik Standartı)
    duration_delta = session.left_at - session.joined_at
    session.duration_seconds = max(int(duration_delta.total_seconds()), 0)
    
    db.commit()
    return {
        "status": "success", 
        "session_id": str(session.id), 
        "duration_seconds": session.duration_seconds
    }

@router.get("/meeting/{meeting_id}", response_model=List[ParticipantSessionOut])
def read_meeting_sessions(
    meeting_id: UUID,
    db: Session = Depends(get_db),
    current_user: any = Depends(get_current_user)
):
    """Raporlama katmanının beslenmesi için odaya ait tüm geçmiş oturum loglarını döner."""
    sessions = db.query(ParticipantSession).filter(
        ParticipantSession.meeting_id == meeting_id
    ).order_by(ParticipantSession.joined_at.asc()).all()
    return sessions