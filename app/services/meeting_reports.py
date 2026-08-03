from datetime import timezone
from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional, List
from app.models.meeting import Meeting
from app.models.participant_session import ParticipantSession
from app.models.meeting_note import MeetingNote
from app.models.user import User

from app.core.tz import get_tr_now

def generate_meeting_report_data(db: Session, meeting_id: UUID, current_user_id: Optional[UUID] = None) -> Optional[dict]:
    """Toplantıya ait tüm analitik verileri toplayıp rapor sözlüğü üretir."""
    # 1. Toplantıyı getir
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        return None

    # 2. Katılımcı Oturum Sürelerini Hesapla
    stmt_sessions = (
        select(
            User.id,
            User.first_name,
            User.last_name,
            User.user_code,
            func.sum(func.coalesce(ParticipantSession.duration_seconds, 0)).label("total_seconds"),
            func.count(ParticipantSession.id).label("session_count")
        )
        .join(ParticipantSession, ParticipantSession.user_id == User.id)
        .where(ParticipantSession.meeting_id == meeting_id)
        .group_by(User.id)
    )
    session_rows = db.execute(stmt_sessions).all()
    
    participants_summary = []
    total_meeting_seconds = 0
    
    for row in session_rows:
        seconds = int(row[4])
        active_minutes = round(seconds / 60.0, 2)
        participants_summary.append({
            "user_id": row[0],
            "first_name": row[1],
            "last_name": row[2],
            "user_code": row[3],
            "total_active_minutes": active_minutes,
            "total_sessions": int(row[5])
        })
        total_meeting_seconds += seconds

    # 3. Toplantı Notlarını Getir
    stmt_notes = (
        select(MeetingNote)
        .where(MeetingNote.meeting_id == meeting_id)
        .order_by(MeetingNote.created_at.asc())
    )
    notes_list = db.scalars(stmt_notes).all()
    notes_summary = []
    general_notes = []
    personal_notes = []

    for note in notes_list:
        note_type = getattr(note, 'note_type', 'general') or 'general'
        if note_type == 'personal':
            if not current_user_id or note.author_id != current_user_id:
                continue

        author_name = "Bilinmeyen Katılımcı"
        if note.author_id:
            author = db.get(User, note.author_id)
            if author:
                author_name = f"{author.first_name or ''} {author.last_name or ''}".strip() or author.email
        
        item = {
            "id": note.id,
            "author_name": author_name,
            "content": note.content,
            "note_type": note_type,
            "created_at": note.created_at
        }
        notes_summary.append(item)
        if note_type == 'personal':
            personal_notes.append(item)
        else:
            general_notes.append(item)

    # 4. Başlangıç zamanını belirle
    scheduled_start_val = getattr(meeting, 'start_time', None)
    if scheduled_start_val is None:
        scheduled_start_val = getattr(meeting, 'scheduled_start', None)
    if scheduled_start_val is None:
        scheduled_start_val = getattr(meeting, 'start_date', None)
    if scheduled_start_val is None:
        scheduled_start_val = getattr(meeting, 'created_at', get_tr_now())

    host_name = "Bilinmeyen Düzenleyici"
    if getattr(meeting, 'created_by', None):
        host_user = db.get(User, meeting.created_by)
        if host_user:
            host_name = f"{host_user.first_name or ''} {host_user.last_name or ''}".strip() or host_user.email

    report_data = {
        "meeting_id": meeting.id,
        "meeting_title": meeting.title,
        "meeting_code": meeting.meeting_code,
        "meeting_description": getattr(meeting, 'description', None),
        "agenda": getattr(meeting, 'agenda', None),
        "meeting_type": getattr(meeting, 'meeting_type', 'Genel Toplantı'),
        "host_name": host_name,
        "scheduled_start": scheduled_start_val,
        "actual_start": getattr(meeting, 'actual_start', None),
        "actual_end": getattr(meeting, 'actual_end', None),
        "actual_duration_minutes": round(total_meeting_seconds / 60.0, 2),
        "total_participants_count": len(participants_summary),
        "total_notes_count": len(notes_summary),
        "participants_summary": participants_summary,
        "notes": notes_summary,
        "general_notes": general_notes,
        "personal_notes": personal_notes,
    }
    return report_data

