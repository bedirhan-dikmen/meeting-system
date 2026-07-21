# app/routes/participants.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from datetime import datetime

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.meeting_participant import MeetingParticipant
from app.models.meeting import Meeting
from app.schemas.participants import (
    MeetingParticipantCreate,
    MeetingParticipantOut,
    MeetingParticipantUpdate
)

router = APIRouter(prefix="/participants", tags=["Katılımcı ve Davet Yönetimi"])

@router.post("/invite", response_model=MeetingParticipantOut, status_code=status.HTTP_201_CREATED)
def invite_user(
    payload: MeetingParticipantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Sisteme kayıtlı bir personeli kurumsal toplantıya davet eder.
    Varsayılan durumu 'pending' (bekliyor) olarak mühürler.
    """
    # Toplantı var mı kontrol et
    meeting = db.get(Meeting, payload.meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Toplantı odası bulunamadı.")
        
    # Kullanıcı zaten davet edilmiş mi kontrol et
    exists = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == payload.meeting_id,
        MeetingParticipant.user_id == payload.user_id
    ).first()
    
    if exists:
        return exists

    db_participant = MeetingParticipant(
        meeting_id=payload.meeting_id,
        user_id=payload.user_id,
        role=payload.role if hasattr(payload, 'role') else "participant",
        status="pending",  # pending, accepted, declined
        invited_at=datetime.utcnow()
    )
    db.add(db_participant)
    db.commit()
    db.refresh(db_participant)
    return db_participant

@router.get("/{meeting_id}", response_model=List[MeetingParticipantOut])
def read_participants(
    meeting_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Belirli bir toplantıya ait tüm davetlilerin ve katılımcıların listesini getirir."""
    participants = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting_id
    ).all()
    return participants

@router.put("/{meeting_id}/users/{user_id}", response_model=MeetingParticipantOut)
def update_participant(
    meeting_id: UUID,
    user_id: UUID,
    payload: MeetingParticipantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Katılımcının odadaki rolünü veya davet yanıt durumunu (accepted/declined) günceller."""
    participant = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting_id,
        MeetingParticipant.user_id == user_id
    ).first()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Katılımcı kaydı bulunamadı.")
        
    if payload.status:
        participant.status = payload.status
    if payload.role:
        participant.role = payload.role
        
    db.commit()
    db.refresh(participant)
    return participant

@router.delete("/{meeting_id}/users/{user_id}", status_code=status.HTTP_200_OK)
def remove_participant_from_meeting(
    meeting_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    TOPLANTI SAHİBİ ÖZELLİĞİ: İstenmeyen veya kuralları ihlal eden 
    bir kullanıcıyı odadan çıkartır (Kick).
    """
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Toplantı bulunamadı.")
        
    # Yetki Kontrolü: Sadece toplantıyı oluşturan veya sistem yöneticisi atabilir
    if meeting.created_by != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Kullanıcıyı odadan çıkarma yetkiniz yok.")
        
    participant = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting_id,
        MeetingParticipant.user_id == user_id
    ).first()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Kullanıcı bu odada bulunmuyor.")
        
    db.delete(participant)
    db.commit()
    return {"status": "success", "message": "Kullanıcı toplantı odasından uzaklaştırıldı."}