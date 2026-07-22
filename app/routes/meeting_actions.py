from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.meeting_actions import MeetingActionOut, MeetingActionCreate
from app.services import meeting_actions as action_service

router = APIRouter(prefix="/actions", tags=["Toplantı Aksiyon Kararları"])

@router.post("/", response_model=MeetingActionOut, status_code=status.HTTP_201_CREATED)
def create_meeting_action(
    payload: MeetingActionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Toplantıda alınan yeni bir aksiyon kararını/görevini ekler."""
    return action_service.create_action(db, action_data=payload, creator_id=current_user.id)

@router.get("/meeting/{meeting_id}", response_model=List[MeetingActionOut])
def read_meeting_actions(
    meeting_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Bir toplantıdaki tüm aksiyon görevlerini listeler."""
    return action_service.get_meeting_actions(db, meeting_id=meeting_id)

@router.put("/{action_id}/status", response_model=MeetingActionOut)
def update_action_completion(
    action_id: UUID,
    is_completed: bool,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Görev tamamlanma durumunu günceller."""
    action = action_service.update_action_status(db, action_id=action_id, is_completed=is_completed)
    if not action:
        raise HTTPException(status_code=404, detail="Aksiyon kararı bulunamadı.")
    return action