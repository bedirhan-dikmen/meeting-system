from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional, List
import secrets

from app.models.meeting import Meeting
from app.models.meeting_participant import MeetingParticipant
from app.models.notification import Notification
from app.schemas.meetings import MeetingCreate, MeetingUpdate

# Toplantının artık düzenlemeye/katılıma kapalı (tamamlanmış ya da iptal
# edilmiş) sayıldığı durum değerleri. app/static/js/meetings.js'teki
# Meetings.normalizeStatus() ve app/routes/dashboard.py'deki status
# kümeleriyle birebir tutarlı tutulmalı.
_COMPLETED_STATUS_VALUES = {
    "tamamlandı", "tamamlandi", "completed", "ended", "finished",
    "bitti", "kapandı", "kapandi", "kaptildi",
}
_CANCELLED_STATUS_VALUES = {
    "iptal edildi", "iptal", "cancelled", "canceled"
}
_FINISHED_STATUS_VALUES = _COMPLETED_STATUS_VALUES | _CANCELLED_STATUS_VALUES

def is_meeting_finished(meeting: Meeting) -> bool:
    """Toplantının artık düzenlemeye (not/aksiyon/bilgi güncelleme) ve yeniden
    katılıma kapalı olup olmadığını döner (bitmiş/iptal edilmiş toplantılara
    geri/ileri tuşuyla dönüp değişiklik yapılmasını engellemek için)."""
    status_val = str(getattr(meeting, "status", "") or "").strip().lower()
    return status_val in _FINISHED_STATUS_VALUES

def is_meeting_completed(meeting: Meeting) -> bool:
    """Toplantının (iptal DEĞİL, gerçekten) tamamlanmış olup olmadığını döner
    — profil sayfasındaki 'Katıldığım Toplantılar & Resmi Raporlar' listesi
    gibi sadece kesinleşmiş/raporu olan toplantıları göstermesi gereken
    yerlerde kullanılır (bkz. routes/users.py profile-overview)."""
    status_val = str(getattr(meeting, "status", "") or "").strip().lower()
    return status_val in _COMPLETED_STATUS_VALUES

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

    from app.core.tz import to_tr_naive, get_tr_now

    scheduled_start = to_tr_naive(meeting_data.scheduled_start) or get_tr_now()

    if meeting_data.scheduled_end:
        scheduled_end = to_tr_naive(meeting_data.scheduled_end)
    else:
        duration = meeting_data.duration_minutes or 30
        scheduled_end = scheduled_start + timedelta(minutes=duration)

    m_type = meeting_data.meeting_type or "Genel Toplantı"
    if meeting_data.status:
        m_status = meeting_data.status
    elif m_type == "Hızlı Toplantı":
        m_status = "canlı"
    else:
        m_status = "planlandı"

    db_meeting = Meeting(
        title=meeting_data.title,
        description=meeting_data.description,
        scheduled_start=scheduled_start,
        scheduled_end=scheduled_end,
        meeting_code=code,
        meeting_type=m_type,
        agenda=meeting_data.agenda,
        status=m_status,
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
        from app.models.user import User
        for u_id in meeting_data.invited_user_ids:
            try:
                target_user_id = UUID(str(u_id))
            except (ValueError, TypeError):
                continue

            if str(target_user_id) != str(host_id):
                # Veritabanında kullanıcının varlığını doğrula (FK hatasını önlemek için)
                user_exists = db.query(User.id).filter(User.id == target_user_id).first()
                if not user_exists:
                    continue

                # Duplicate katılım kontrolü
                existing_p = db.query(MeetingParticipant).filter(
                    MeetingParticipant.meeting_id == db_meeting.id,
                    MeetingParticipant.user_id == target_user_id
                ).first()
                if not existing_p:
                    participant = MeetingParticipant(
                        meeting_id=db_meeting.id,
                        user_id=target_user_id,
                        role="participant",
                        status="pending"
                    )
                    db.add(participant)

                start_dt = db_meeting.scheduled_start
                start_str = start_dt.strftime('%d.%m.%Y %H:%M') if hasattr(start_dt, 'strftime') else str(start_dt or '')

                notif = Notification(
                    user_id=target_user_id,
                    title="Yeni Toplantı Daveti",
                    message=f"'{db_meeting.title}' toplantısına davet edildiniz. Tarih: {start_str}",
                    meeting_code=code
                )
                db.add(notif)

    try:
        db.commit()
        db.refresh(db_meeting)
    except Exception as e:
        db.rollback()
        print(f"[create_new_meeting] Bildirim ekleme hatası: {e}")

    return db_meeting

from sqlalchemy.orm import Session, selectinload

from app.models.participant_session import ParticipantSession

def get_meetings_list(db: Session, skip: int = 0, limit: int = 100, user_id: Optional[UUID] = None, is_admin: bool = False) -> List[Meeting]:
    """Sistemdeki veya kullanıcının davetli olduğu/oluşturduğu aktif toplantıları eager loading ile listeler (N+1 engellendi)."""
    query = db.query(Meeting).options(
        selectinload(Meeting.participants),
        selectinload(Meeting.notes),
        selectinload(Meeting.actions),
        selectinload(Meeting.creator)
    ).filter(Meeting.is_active == True)

    if user_id and not is_admin:
        user_meeting_ids = db.query(MeetingParticipant.meeting_id).filter(
            MeetingParticipant.user_id == user_id
        ).union(
            db.query(ParticipantSession.meeting_id).filter(
                ParticipantSession.user_id == user_id
            )
        )
        query = query.filter((Meeting.created_by == user_id) | (Meeting.id.in_(user_meeting_ids)))

    return query.order_by(Meeting.created_at.desc()).offset(skip).limit(limit).all()

def get_meeting_by_id(db: Session, meeting_id: UUID) -> Optional[Meeting]:
    """UUID ile spesifik bir toplantıyı eager loading ile çeker."""
    return db.query(Meeting).options(
        selectinload(Meeting.participants),
        selectinload(Meeting.notes),
        selectinload(Meeting.actions),
        selectinload(Meeting.creator)
    ).filter(Meeting.id == meeting_id).first()

def get_meeting_by_code(db: Session, code: str) -> Optional[Meeting]:
    """Oda kodu ile spesifik bir toplantıyı eager loading ile çeker."""
    return db.query(Meeting).options(
        selectinload(Meeting.participants),
        selectinload(Meeting.notes),
        selectinload(Meeting.actions),
        selectinload(Meeting.creator)
    ).filter(Meeting.meeting_code == code).first()

def update_meeting_details(db: Session, meeting_id: UUID, update_data: MeetingUpdate) -> Optional[Meeting]:
    """Toplantı bilgilerini günceller."""
    db_meeting = get_meeting_by_id(db, meeting_id)
    if not db_meeting:
        return None

    from app.core.tz import to_tr_naive

    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        # BUG FIX: Toplantı saati artık düzenleme modalından da
        # güncellenebiliyor (bkz. base.html editMeetingModal / meetings.js
        # openEditModal+formEdit submit) — create_new_meeting'deki gibi TR
        # saat dilimine normalize edilmeden direkt setattr edilirse
        # create/update arasında tutarsız bir saat kaydı oluşurdu.
        if key in ("scheduled_start", "scheduled_end") and value is not None:
            value = to_tr_naive(value)
        setattr(db_meeting, key, value)

    db.commit()
    db.refresh(db_meeting)
    return db_meeting