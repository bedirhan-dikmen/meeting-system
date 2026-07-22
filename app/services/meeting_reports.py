from datetime import timezone
from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional, List
from app.models import meeting
from app.models.meeting import Meeting
from app.models.participant_session import ParticipantSession
from app.models.meeting_note import MeetingNote
from app.models.meeting_action import MeetingAction
from app.models.user import User

def generate_meeting_report_data(db: Session, meeting_id: UUID) -> Optional[dict]:
    """Toplantıya ait tüm analitik verileri toplayıp rapor sözlüğü üretir."""
    # 1. Toplantıyı getir
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        return None

    # 2. Katılımcı Oturum Sürelerini Hesapla (duration_seconds kolonu üzerinden)
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
        # Saniyeyi dakika formatına (float) dönüştürüyoruz
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

    # 3. Toplantı Notlarını Getir (content kolonunuza göre senkronize)
    stmt_notes = (
        select(MeetingNote)
        .where(MeetingNote.meeting_id == meeting_id)
        .order_by(MeetingNote.created_at.asc())
    )
    notes_list = db.scalars(stmt_notes).all()
    notes_summary = []
    for note in notes_list:
        author_name = "Bilinmeyen Katılımcı"
        if note.author_id:
            author = db.get(User, note.author_id)
            if author:
                author_name = f"{author.first_name} {author.last_name}"
        notes_summary.append({
            "id": note.id,
            "author_name": author_name,
            "content": note.content,  # Sizin modelinizdeki "content" kolonu
            "created_at": note.created_at
        })

    # 4. Toplantı Aksiyon Kararlarını Getir
    stmt_actions = (
        select(MeetingAction)
        .where(MeetingAction.meeting_id == meeting_id)
        .order_by(MeetingAction.created_at.asc())
    )
    actions_list = db.scalars(stmt_actions).all()
    actions_summary = []
    for action in actions_list:
        assignee_name = None
        if action.assigned_to:
            assignee = db.get(User, action.assigned_to)
            if assignee:
                assignee_name = f"{assignee.first_name} {assignee.last_name}"
        actions_summary.append({
            "id": action.id,
            "title": action.title,
            "description": action.description,
            "assigned_to_name": assignee_name,
            "due_date": action.due_date,
            "is_completed": action.is_completed
        })

    # 5. Rapor Sözlüğünü Birleştir
    # Modelinizde start_time yoksa hasattr ile güvenli kontrol yapıyoruz, 
    # start_time yoksa sırasıyla scheduled_start, start_date veya created_at alanını arayacaktır.
    scheduled_start_val = getattr(meeting, 'start_time', None)
    if scheduled_start_val is None:
        scheduled_start_val = getattr(meeting, 'scheduled_start', None)
    if scheduled_start_val is None:
        scheduled_start_val = getattr(meeting, 'start_date', None)
    if scheduled_start_val is None:
        scheduled_start_val = getattr(meeting, 'created_at', datetime.now(timezone.utc))

    report_data = {
        "meeting_id": meeting.id,
        "meeting_title": meeting.title,
        "meeting_code": meeting.meeting_code,
        "scheduled_start": scheduled_start_val,  # Güvenli dinamik eşleme tamam!
        "actual_duration_minutes": round(total_meeting_seconds / 60.0, 2),
        "total_participants_count": len(participants_summary),
        "total_notes_count": len(notes_summary),
        "total_actions_count": len(actions_summary),
        "participants_summary": participants_summary,
        "notes": notes_summary,
        "actions": actions_summary
    }
    return report_data