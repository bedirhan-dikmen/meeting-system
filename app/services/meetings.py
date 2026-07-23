from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional, List
import secrets

from app.models.meeting import Meeting
from app.models.meeting_participant import MeetingParticipant
from app.models.notification import Notification
from app.schemas.meetings import MeetingCreate, MeetingUpdate

def generate_unique_meeting_code() -> str:
    """WebRTC sinyalleşme odaları için benzersiz kod üretir."""
    part1 = "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(4))
    part2 = "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(4))
    return f"yeb-{part1}-{part2}"

from datetime import timedelta

def create_new_meeting(db: Session, meeting_data: MeetingCreate, host_id: UUID) -> Meeting:
    """Model parametrelerine tam uyumlu toplantı kaydı oluşturur ve davetlileri kaydeder."""
    while True:
        code = generate_unique_meeting_code()
        existing = db.query(Meeting).filter(Meeting.meeting_code == code).first()
        if not existing:
            break

    scheduled_start = meeting_data.scheduled_start
    if scheduled_start and getattr(scheduled_start, 'tzinfo', None) is not None:
        scheduled_start = scheduled_start.replace(tzinfo=None)

    if meeting_data.scheduled_end:
        scheduled_end = meeting_data.scheduled_end
        if getattr(scheduled_end, 'tzinfo', None) is not None:
            scheduled_end = scheduled_end.replace(tzinfo=None)
    else:
        duration = meeting_data.duration_minutes or 30
        scheduled_end = scheduled_start + timedelta(minutes=duration)

    db_meeting = Meeting(
        title=meeting_data.title,
        description=meeting_data.description,
        scheduled_start=scheduled_start,
        scheduled_end=scheduled_end,
        meeting_code=code,
        meeting_type=meeting_data.meeting_type or "Genel Toplantı",
        agenda=meeting_data.agenda,
        status=meeting_data.status or "planlandı",
        passcode=meeting_data.passcode,
        lobby_enabled=bool(meeting_data.lobby_enabled),
        is_private=bool(meeting_data.is_private),
        created_by=host_id,
        is_active=True
    )
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)


    # Toplantı Yöneticisini Moderator olarak ekle
    host_participant = MeetingParticipant(
        meeting_id=db_meeting.id,
        user_id=host_id,
        role="moderator",
        status="accepted"
    )
    db.add(host_participant)

    # Davet edilen kullanıcıları ekle ve bildirim gönder
    if meeting_data.invited_user_ids:
        for user_id in meeting_data.invited_user_ids:
            if user_id != host_id:
                participant = MeetingParticipant(
                    meeting_id=db_meeting.id,
                    user_id=user_id,
                    role="participant",
                    status="pending"
                )
                db.add(participant)

                # Bildirim oluştur
                notif = Notification(
                    user_id=user_id,
                    title="Yeni Toplantı Daveti",
                    message=f"'{db_meeting.title}' toplantısına davet edildiniz. Tarih: {db_meeting.scheduled_start.strftime('%d.%m.%Y %H:%M')}"
                )
                db.add(notif)

    db.commit()
    db.refresh(db_meeting)
    return db_meeting

def get_meetings_list(db: Session, skip: int = 0, limit: int = 100) -> List[Meeting]:
    """Sistemdeki aktif toplantıları listeler."""
    return db.query(Meeting).filter(Meeting.is_active == True).order_by(Meeting.created_at.desc()).offset(skip).limit(limit).all()

def get_meeting_by_id(db: Session, meeting_id: UUID) -> Optional[Meeting]:
    """UUID ile spesifik bir toplantıyı çeker."""
    return db.query(Meeting).filter(Meeting.id == meeting_id).first()

def get_meeting_by_code(db: Session, code: str) -> Optional[Meeting]:
    """Oda kodu ile spesifik bir toplantıyı çeker."""
    return db.query(Meeting).filter(Meeting.meeting_code == code).first()

def update_meeting_details(db: Session, meeting_id: UUID, update_data: MeetingUpdate) -> Optional[Meeting]:
    """Toplantı bilgilerini günceller."""
    db_meeting = get_meeting_by_id(db, meeting_id)
    if not db_meeting:
        return None
    
    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(db_meeting, key, value)
        
    db.commit()
    db.refresh(db_meeting)
    return db_meeting