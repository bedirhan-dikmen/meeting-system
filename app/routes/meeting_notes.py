from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List

from app.core.database import get_db
from app.core.security import get_current_user, verify_meeting_access
from app.models.user import User
from app.models.meeting import Meeting
from app.schemas.meeting_notes import MeetingNoteOut, MeetingNoteCreate
from app.services import meeting_notes as notes_service

router = APIRouter(prefix="/notes", tags=["Toplantı Notları"])

@router.post("/", response_model=MeetingNoteOut, status_code=status.HTTP_201_CREATED)
def create_meeting_note(
    payload: MeetingNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Toplantıya anlık not ekler.

    BUG FIX: 'general' (genel/resmi karar) tipi notlar eskiden HERHANGİ bir
    katılımcı tarafından oluşturulabiliyordu — sadece arayüzde (room.html)
    gizli olan bir form vardı ama API'ye doğrudan istek atan biri yine de
    genel not yayınlayabiliyordu. Artık sadece toplantıyı oluşturan (editör)
    veya admin/manager rolündeki kullanıcılar genel not oluşturabilir;
    diğerleri sadece görüntüleyebilir. 'personal' notlar (herkesin kendine
    özel) bu kısıtlamadan etkilenmez.
    """
    if (payload.note_type or "general") == "general":
        meeting = db.query(Meeting).filter(Meeting.id == payload.meeting_id).first()
        if not meeting:
            raise HTTPException(status_code=404, detail="Toplantı bulunamadı.")
        is_creator = meeting.created_by == current_user.id
        is_privileged_role = str(getattr(current_user, "role", "")).lower() in ("admin", "manager")
        if not (is_creator or is_privileged_role):
            raise HTTPException(
                status_code=403,
                detail="Genel not/karar yalnızca toplantı editörü veya yöneticiler tarafından oluşturulabilir."
            )

    author_id = current_user.id
    return notes_service.create_note(db, note_data=payload, author_id=author_id)

@router.get("/meeting/{meeting_id}", response_model=List[MeetingNoteOut])
def read_meeting_notes(
    meeting_id: UUID,
    db: Session = Depends(get_db),
    access_claims: dict = Depends(verify_meeting_access)
):
    """Bir toplantıya ait tüm notları listeler (Yetki sarmalayıcısı korumalı)."""
    user_id_str = access_claims.get("sub")
    current_user_id = UUID(user_id_str) if user_id_str else None
    return notes_service.get_meeting_notes(db, meeting_id=meeting_id, user_id=current_user_id)

@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting_note(
    note_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Yazarı olduğunuz bir toplantı notunu siler."""
    success = notes_service.delete_note(db, note_id=note_id, user_id=current_user.id)
    if not success:
        raise HTTPException(
            status_code=403, 
            detail="Not bulunamadı ya da bu işlem için yetkiniz yok."
        )