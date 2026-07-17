from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List
from app.core.database import get_db
from app.core.security import get_current_user
from app.schemas.meeting_notes import MeetingNoteOut, MeetingNoteCreate
from app.services import meeting_notes as notes_service

router = APIRouter(prefix="/notes", tags=["Toplantı Notları"])

@router.post("/", response_model=MeetingNoteOut, status_code=status.HTTP_201_CREATED)
def create_meeting_note(
    payload: MeetingNoteCreate,
    db: Session = Depends(get_db),
    current_user: any = Depends(get_current_user)
):
    """Toplantıya anlık not ekler."""
    return notes_service.create_note(db, note_data=payload, author_id=current_user.id)

@router.get("/meeting/{meeting_id}", response_model=List[MeetingNoteOut])
def read_meeting_notes(
    meeting_id: UUID,
    db: Session = Depends(get_db),
    current_user: any = Depends(get_current_user)
):
    """Bir toplantıya ait tüm notları listeler."""
    return notes_service.get_meeting_notes(db, meeting_id=meeting_id)

@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting_note(
    note_id: UUID,
    db: Session = Depends(get_db),
    current_user: any = Depends(get_current_user)
):
    """Yazarı olduğunuz bir toplantı notunu siler."""
    success = notes_service.delete_note(db, note_id=note_id, user_id=current_user.id)
    if not success:
        raise HTTPException(
            status_code=403, 
            detail="Not bulunamadı ya da bu işlem için yetkiniz yok."
        )