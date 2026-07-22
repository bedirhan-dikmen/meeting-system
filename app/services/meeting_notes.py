from datetime import timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime
from typing import List, Optional
from app.models.meeting_note import MeetingNote
from app.schemas.meeting_notes import MeetingNoteCreate

def create_note(db: Session, note_data: MeetingNoteCreate, author_id: UUID) -> MeetingNote:
    """Toplantı esnasında yeni bir anlık not kaydeder."""
    db_note = MeetingNote(
        meeting_id=note_data.meeting_id,
        author_id=author_id,
        content=note_data.content,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note

def get_meeting_notes(db: Session, meeting_id: UUID) -> List[MeetingNote]:
    """Bir toplantıya ait tüm anlık notları getirir."""
    stmt = select(MeetingNote).where(MeetingNote.meeting_id == meeting_id).order_by(MeetingNote.created_at.desc())
    return list(db.scalars(stmt).all())

def delete_note(db: Session, note_id: UUID, user_id: UUID) -> bool:
    """Notu siler (Sadece notu yazan kullanıcı silebilir)."""
    db_note = db.get(MeetingNote, note_id)
    if not db_note or db_note.author_id != user_id:
        return False
    db.delete(db_note)
    db.commit()
    return True