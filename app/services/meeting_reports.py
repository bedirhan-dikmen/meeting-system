# app/services/meeting_reports.py
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime
from typing import Optional

from app.models.meeting import Meeting
from app.models.user import User
from app.models.participant_session import ParticipantSession
from app.models.meeting_note import MeetingNote

def generate_meeting_report_data(db: Session, meeting_id: UUID) -> Optional[dict]:
    """Toplantıya ait tüm analitik katılım cetvellerini, notları ve host künyesini rapora derler."""
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        return None

    # Toplantı Yöneticisi (Host) Bilgisi
    host = db.get(User, meeting.created_by)
    manager_name = f"{host.first_name or ''} {host.last_name or ''}".strip() if host else "Sistem Yöneticisi"

    # 1. KATILIMCI OTURUM KÜMÜLATİF SÜRE VE ZAMAN CETVELİ SORGU KATMANI
    stmt_sessions = (
        select(
            User.first_name,
            User.last_name,
            User.email,
            User.user_code,
            func.min(ParticipantSession.joined_at).label("first_join"),
            func.max(ParticipantSession.left_at).label("last_leave"),
            func.sum(func.coalesce(ParticipantSession.duration_seconds, 0)).label("total_seconds")
        )
        .join(ParticipantSession, ParticipantSession.user_id == User.id)
        .where(ParticipantSession.meeting_id == meeting_id)
        .group_by(User.id, User.first_name, User.last_name, User.email, User.user_code)
    )
    session_rows = db.execute(stmt_sessions).all()
    
    participants_summary = []
    total_meeting_seconds = 0
    
    for row in session_rows:
        secs = row.total_seconds or 0
        total_meeting_seconds += secs
        full_name = f"{row.first_name or ''} {row.last_name or ''}".strip() or row.email
        
        participants_summary.append({
            "full_name": full_name,
            "email": row.email,
            "user_code": row.user_code or "-",
            "join_time": row.first_join,
            "leave_time": row.last_leave,
            "duration_minutes": round(secs / 60.0, 1)
        })

    # 2. TOPLANTI İÇİ NOTLAR VE ALINAN KARARLAR SORGU KATMANI
    stmt_notes = (
        select(MeetingNote, User.first_name, User.last_name, User.email)
        .outerjoin(User, MeetingNote.author_id == User.id)
        .where(MeetingNote.meeting_id == meeting_id)
        .order_by(MeetingNote.created_at.asc())
    )
    note_rows = db.execute(stmt_notes).all()
    
    notes_summary = []
    for note, fn, ln, email in note_rows:
        author_name = f"{fn or ''} {ln or ''}".strip() or email or "Katılımcı"
        notes_summary.append({
            "note_type": note.note_type if hasattr(note, 'note_type') else "GENERAL",
            "author_name": author_name,
            "content": note.content,
            "created_at": note.created_at
        })

    return {
        "meeting_id": meeting.id,
        "meeting_title": meeting.title,
        "meeting_code": meeting.meeting_code,
        "description": meeting.description,
        "meeting_type": meeting.meeting_type if hasattr(meeting, 'meeting_type') else "GENERAL",
        "manager_name": manager_name,
        "scheduled_start": meeting.scheduled_start,
        "scheduled_end": meeting.scheduled_end,
        "actual_duration_minutes": round(total_meeting_seconds / 60.0, 1),
        "participants": participants_summary,
        "notes": notes_summary
    }