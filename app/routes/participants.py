from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.participants import (
    MeetingParticipantCreate,
    MeetingParticipantOut,
    MeetingParticipantUpdate
)
from app.services.participants import (
    invite_user_to_meeting,
    get_meeting_participants,
    update_participant_status_or_role,
    remove_participant_from_meeting
)

router = APIRouter()

@router.post("/invite", response_model=MeetingParticipantOut, status_code=status.HTTP_201_CREATED)
def invite_user(
    payload: MeetingParticipantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Sisteme kayıtlı bir kullanıcıyı UUID tabanlı toplantıya davet eder.
    """
    return invite_user_to_meeting(db, participant_data=payload)

from app.core.security import get_current_user, verify_meeting_access

@router.get("/{meeting_id}", response_model=List[MeetingParticipantOut])
def read_participants(
    meeting_id: UUID,
    db: Session = Depends(get_db),
    access_claims: dict = Depends(verify_meeting_access)
):
    """
    Belirli bir toplantıya ait tüm katılımcıların listesini getirir (Yetki sarmalayıcısı korumalı).
    """
    return get_meeting_participants(db, meeting_id=meeting_id)

@router.put("/{meeting_id}/users/{user_id}", response_model=MeetingParticipantOut)
def update_participant(
    meeting_id: UUID,
    user_id: UUID,
    payload: MeetingParticipantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Katılımcının odadaki rolünü veya katılım durumunu (invited, joined, left vb.) günceller.
    """
    return update_participant_status_or_role(
        db, meeting_id=meeting_id, user_id=user_id, update_data=payload
    )

@router.delete("/{meeting_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_participant(
    meeting_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Bir katılımcıyı toplantı listesinden tamamen siler.
    """
    remove_participant_from_meeting(db, meeting_id=meeting_id, user_id=user_id)
    return None