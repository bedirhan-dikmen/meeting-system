from sqlalchemy import select, or_, and_
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime
from typing import List, Optional
from app.models.meeting_note import MeetingNote
from app.schemas.meeting_notes import MeetingNoteCreate
from app.core.tz import get_tr_now

def create_note(db: Session, note_data: MeetingNoteCreate, author_id: UUID) -> MeetingNote:
    """Toplantı esnasında yeni bir anlık not kaydeder."""
    now_tr = get_tr_now()
    db_note = MeetingNote(
        meeting_id=note_data.meeting_id,
        author_id=author_id,
        content=note_data.content,
        note_type=getattr(note_data, 'note_type', 'general') or 'general',
        created_at=now_tr,
        updated_at=now_tr
    )
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note

def get_meeting_notes(db: Session, meeting_id: UUID, user_id: Optional[UUID] = None) -> List[MeetingNote]:
    """Bir toplantıya ait genel notları ve kullanıcının kendi kişisel notlarını getirir."""
    if user_id:
        stmt = (
            select(MeetingNote)
            .where(
                MeetingNote.meeting_id == meeting_id,
                or_(
                    MeetingNote.note_type == 'general',
                    MeetingNote.note_type == None,
                    and_(MeetingNote.note_type == 'personal', MeetingNote.author_id == user_id)
                )
            )
            .order_by(MeetingNote.created_at.desc())
        )
    else:
        stmt = (
            select(MeetingNote)
            .where(
                MeetingNote.meeting_id == meeting_id,
                or_(MeetingNote.note_type == 'general', MeetingNote.note_type == None)
            )
            .order_by(MeetingNote.created_at.desc())
        )
    return list(db.scalars(stmt).all())

def delete_note(db: Session, note_id: UUID, user_id: UUID) -> bool:
    """Notu siler (Sadece notu yazan kullanıcı silebilir)."""
    db_note = db.get(MeetingNote, note_id)
    if not db_note or db_note.author_id != user_id:
        return False
    db.delete(db_note)
    db.commit()
    return True