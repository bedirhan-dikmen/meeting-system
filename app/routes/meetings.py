from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.meeting import Meeting
from app.models.user import User
from app.schemas.meetings import MeetingCreate, MeetingOut, MeetingUpdate
from app.services.meetings import (
    create_new_meeting,
    get_meetings_list,
    get_meeting_by_id,
    get_meeting_by_code,
    update_meeting_details
)
from app.services.event_bus import event_bus

router = APIRouter()

@router.post("/", response_model=MeetingOut, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    payload: MeetingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Sisteme giriş yapmış kullanıcının (Host) yeni bir toplantı planlamasını sağlar."""
    # created_by UUID tabanlı olduğu için user.id'yi doğrudan güvenle UUID olarak aktarıyoruz
    host_id = getattr(current_user, "id", None)
    if not host_id:
        raise HTTPException(status_code=401, detail="Kullanıcı kimliği doğrulanamadı.")
    new_meeting = create_new_meeting(db, meeting_data=payload, host_id=host_id)

    await event_bus.broadcast_event(
        event_type="MEETING_CREATED",
        payload={
            "id": str(new_meeting.id),
            "meeting_code": new_meeting.meeting_code,
            "title": new_meeting.title,
            "created_by": str(host_id)
        }
    )
    return enrich_meeting_active_users(new_meeting)

from app.services.signaling import signaling_manager

def enrich_meeting_active_users(m: Meeting) -> Meeting:
    """Toplantı nesnesine anlık aktif WebRTC odası katılımcılarını ve saat metnini ekler."""
    active_parts = signaling_manager.get_active_participants(m.meeting_code)
    m.active_participants = active_parts
    m.active_count = len(active_parts)
    
    s_time = m.scheduled_start.strftime("%H:%M") if m.scheduled_start else ""
    e_time = m.scheduled_end.strftime("%H:%M") if m.scheduled_end else ""
    m.time_str = f"{s_time} - {e_time}".strip(" -")
    return m

@router.get("/", response_model=List[MeetingOut])
def read_meetings(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Sistemdeki kullanıcının ilişkili olduğu aktif toplantıları listeler."""
    is_admin = getattr(current_user, "role", None) in ["admin", "manager"] or getattr(current_user, "is_superuser", False)
    meetings = get_meetings_list(db, skip=skip, limit=limit, user_id=current_user.id, is_admin=is_admin)
    return [enrich_meeting_active_users(m) for m in meetings]

@router.get("/active/live", response_model=List[MeetingOut])
def read_active_live_meetings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Halen devam eden (canlı/başlamış) kullanıcının veya tüm sistemin toplantılarını listeler."""
    from app.models.meeting import Meeting
    from app.models.meeting_participant import MeetingParticipant
    from app.models.participant_session import ParticipantSession
    from sqlalchemy import func

    is_admin = getattr(current_user, "role", None) in ["admin", "manager"] or getattr(current_user, "is_superuser", False)
    query = db.query(Meeting).filter(
        Meeting.is_active == True,
        func.lower(Meeting.status).in_(["canlı", "canli", "active", "live", "başladı", "basladi"])
    )

    if not is_admin:
        user_id = current_user.id
        user_meeting_ids = db.query(MeetingParticipant.meeting_id).filter(
            MeetingParticipant.user_id == user_id
        ).union(
            db.query(ParticipantSession.meeting_id).filter(
                ParticipantSession.user_id == user_id
            )
        )
        query = query.filter((Meeting.created_by == user_id) | (Meeting.id.in_(user_meeting_ids)))

    active_meetings = query.order_by(Meeting.scheduled_start.desc()).all()
    return [enrich_meeting_active_users(m) for m in active_meetings]

@router.get("/past/history")
def read_meeting_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Tüm geçmiş toplantı kayıtlarını detaylı analitik metrikleri ile döndürür."""
    from app.models.meeting import Meeting
    from app.models.meeting_participant import MeetingParticipant
    from app.models.participant_session import ParticipantSession
    from app.models.meeting_note import MeetingNote
    from app.models.meeting_action import MeetingAction
    from app.models.user import User
    from sqlalchemy import func

    is_admin = getattr(current_user, "role", None) in ["admin", "manager", "host"] or getattr(current_user, "is_superuser", False)
    if not is_admin:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Kayıtlar ve tüm geçmiş toplantı arşivi yalnızca yönetici rolüne sahip kullanıcılara özeldir."
        )

    query = db.query(Meeting).filter(Meeting.status.in_(["tamamlandı", "completed"]))
    meetings = query.order_by(Meeting.created_at.desc()).all()
    history_data = []

    for m in meetings:
        creator_name = "Yeb Soft"
        if m.created_by:
            creator = db.get(User, m.created_by)
            if creator:
                creator_name = f"{creator.first_name or ''} {creator.last_name or ''}".strip() or creator.email

        sessions_count = db.query(func.count(ParticipantSession.id)).filter(ParticipantSession.meeting_id == m.id).scalar() or 0
        notes_count = db.query(func.count(MeetingNote.id)).filter(MeetingNote.meeting_id == m.id).scalar() or 0
        actions_count = db.query(func.count(MeetingAction.id)).filter(MeetingAction.meeting_id == m.id).scalar() or 0
        
        duration_minutes = 30
        if m.actual_start and m.actual_end:
            duration_minutes = max(1, int((m.actual_end - m.actual_start).total_seconds() / 60))
        elif m.scheduled_start and m.scheduled_end:
            duration_minutes = max(1, int((m.scheduled_end - m.scheduled_start).total_seconds() / 60))

        history_data.append({
            "id": str(m.id),
            "meeting_code": m.meeting_code,
            "title": m.title,
            "description": m.description,
            "meeting_type": m.meeting_type or "Genel Toplantı",
            "status": m.status or "planlandı",
            "scheduled_start": m.scheduled_start.isoformat() if m.scheduled_start else None,
            "scheduled_end": m.scheduled_end.isoformat() if m.scheduled_end else None,
            "actual_start": m.actual_start.isoformat() if m.actual_start else None,
            "actual_end": m.actual_end.isoformat() if m.actual_end else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "created_by": str(m.created_by) if m.created_by else None,
            "creator_name": creator_name,
            "duration_minutes": duration_minutes,
            "sessions_count": sessions_count,
            "notes_count": notes_count,
            "actions_count": actions_count,
            "passcode": m.passcode,
            "agenda": m.agenda
        })

    return history_data


@router.get("/{meeting_id}", response_model=MeetingOut)
def read_meeting(
    meeting_id: UUID,  # UUID olarak güncellendi!
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """UUID değerine göre toplantı detayını getirir."""
    meeting = get_meeting_by_id(db, meeting_id=meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Toplantı bulunamadı.")
    return meeting

@router.get("/code/{meeting_code}", response_model=MeetingOut)
def read_meeting_by_code(
    meeting_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Oda koduna (yeb-xxxx-xxxx) göre toplantı detayını getirir."""
    meeting = get_meeting_by_code(db, code=meeting_code)
    if not meeting:
        raise HTTPException(status_code=404, detail="Geçersiz toplantı kodu.")
    return meeting

@router.put("/{meeting_id}", response_model=MeetingOut)
async def update_meeting(
    meeting_id: UUID,  # UUID olarak güncellendi!
    payload: MeetingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Toplantı bilgilerini günceller."""
    meeting = get_meeting_by_id(db, meeting_id=meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Toplantı bulunamadı.")
    
    user_id = getattr(current_user, "id", None)
    user_role = getattr(current_user, "role", None)
    
    # Sadece toplantıyı oluşturan (created_by) veya admin/manager/host güncelleyebilir
    if meeting.created_by != user_id and user_role not in ["admin", "manager", "host"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu toplantıyı güncelleme yetkiniz bulunmuyor."
        )
        
    updated_meeting = update_meeting_details(db, meeting_id=meeting_id, update_data=payload)
    await event_bus.broadcast_event(
        event_type="MEETING_UPDATED",
        payload={
            "id": str(updated_meeting.id),
            "meeting_code": updated_meeting.meeting_code,
            "title": updated_meeting.title,
            "status": updated_meeting.status
        }
    )
    return updated_meeting

@router.delete("/{meeting_id}")
async def cancel_meeting_endpoint(
    meeting_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Toplantıyı iptal eder ve durumunu 'iptal edildi' olarak günceller."""
    meeting = get_meeting_by_id(db, meeting_id=meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Toplantı bulunamadı.")
    
    user_id = getattr(current_user, "id", None)
    user_role = getattr(current_user, "role", None)
    
    if meeting.created_by != user_id and user_role not in ["admin", "manager", "host"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu toplantıyı iptal etme yetkiniz bulunmuyor."
        )
        
    meeting.status = "iptal edildi"
    db.commit()
    await event_bus.broadcast_event(
        event_type="MEETING_CANCELLED",
        payload={
            "id": str(meeting_id),
            "meeting_code": meeting.meeting_code
        }
    )
    return {"message": "Toplantı başarıyla iptal edildi.", "meeting_id": str(meeting_id)}

from app.routes.guest import GuestTokenRequest, GuestTokenResponse, create_guest_token as create_guest_token_route

@router.post("/join-guest", response_model=GuestTokenResponse, status_code=status.HTTP_201_CREATED)
def join_guest(payload: GuestTokenRequest):
    """
    Public endpoint: Dışarıdan katılan misafir kullanıcıların toplantıya güvenli erişim sağlaması için guest_access_token üretir.
    """
    return create_guest_token_route(payload)