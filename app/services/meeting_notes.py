# app/services/meeting_notes.py
from sqlalchemy import select
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime
from typing import List
from app.models.meeting_note import MeetingNote
from app.schemas.meeting_notes import MeetingNoteCreate

def create_note(db: Session, note_data: MeetingNoteCreate, author_id: UUID) -> MeetingNote:
    """Canlı odadan veya rapor ekranından gelen not/karar kaydını veritabanına mühürler."""
    db_note = MeetingNote(
        meeting_id=note_data.meeting_id,
        author_id=author_id,
        content=note_data.content,
        note_type=note_data.note_type if hasattr(note_data, 'note_type') else "GENERAL",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note

def get_meeting_notes(db: Session, meeting_id: UUID) -> List[MeetingNote]:
    """İlgili toplantıya ait tüm notları ve kararları ters kronolojik sıra ile listeler."""
    stmt = select(MeetingNote).where(MeetingNote.meeting_id == meeting_id).order_by(MeetingNote.created_at.desc())
    return list(db.scalars(stmt).all())