# app/routes/meeting_notes.py
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
    """
    Toplantıya anlık not veya alınan karar ekler.
    Kullanıcının JWT kimliğini author_id olarak otomatik bağlar.
    """
    host_id = getattr(current_user, "id", None)
    if not host_id:
        raise HTTPException(status_code=401, detail="Kullanıcı kimliği doğrulanamadı.")
        
    return notes_service.create_note(db, note_data=payload, author_id=host_id)

@router.get("/meeting/{meeting_id}", response_model=List[MeetingNoteOut])
def read_meeting_notes(
    meeting_id: UUID,
    db: Session = Depends(get_db),
    current_user: any = Depends(get_current_user)
):
    """Bir toplantıya ait tüm notları ve kararları ters kronolojik sıra ile listeler."""
    return notes_service.get_meeting_notes(db, meeting_id=meeting_id)

@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting_note(
    note_id: UUID,
    db: Session = Depends(get_db),
    current_user: any = Depends(get_current_user)
):
    """Eklenen bir toplantı notunu veya kararını sistemden kaldırır."""
    note = db.get(notes_service.MeetingNote if hasattr(notes_service, 'MeetingNote') else any, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Not bulunamadı.")
        
    # Yetki kontrolü: Sadece notun yazarı veya admin silebilir
    if note.author_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Bu notu silme yetkinis yok.")
        
    db.delete(note)
    db.commit()
    return status.HTTP_204_NO_CONTENT