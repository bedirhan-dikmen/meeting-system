from datetime import timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from datetime import datetime, date, timedelta
from typing import Dict, Any, List

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.meeting import Meeting
from app.models.meeting_participant import MeetingParticipant
from app.models.participant_session import ParticipantSession

from app.core.tz import get_tr_now
from app.services.signaling import signaling_manager

router = APIRouter(prefix="/dashboard", tags=["Dashboard Analitik"])

@router.get("/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Ana yönetim paneli (Dashboard) için dinamik verileri ve kart listelerini döndürür.
    """
    now = get_tr_now()
    today_start = datetime(now.year, now.month, now.day)
    today_end = today_start + timedelta(days=1)
    month_start = datetime(now.year, now.month, 1)

    user_id = current_user.id

    # Kullanıcının davet edildiği veya katıldığı toplantıların ID subquery'si
    user_meeting_ids = db.query(MeetingParticipant.meeting_id).filter(
        MeetingParticipant.user_id == user_id
    ).union(
        db.query(ParticipantSession.meeting_id).filter(
            ParticipantSession.user_id == user_id
        )
    )

    # Kullanıcının ilişkili olduğu (oluşturduğu veya davetli/katılımcı olduğu) aktif toplantı sorgusu
    user_meetings = db.query(Meeting).filter(
        Meeting.is_active == True,
        (Meeting.created_by == user_id) | (Meeting.id.in_(user_meeting_ids))
    )

    # 1. Metrik Sayıları
    total_users = db.query(func.count(User.id)).scalar() or 0

    active_statuses = ["canlı", "canli", "active", "live", "başladı", "basladi"]

    today_meetings_count = user_meetings.filter(
        (
            (Meeting.scheduled_start >= today_start) & (Meeting.scheduled_start < today_end)
        ) | (
            func.lower(Meeting.status).in_(active_statuses)
        )
    ).count()

    upcoming_meetings_count = user_meetings.filter(
        func.lower(Meeting.status).in_(["planlandı", "planlandi", "scheduled", "planned", "taslak"])
    ).count()

    completed_meetings_count = user_meetings.filter(
        func.lower(Meeting.status).in_(["tamamlandı", "tamamlandi", "completed", "ended"])
    ).count()

    cancelled_meetings_count = user_meetings.filter(
        func.lower(Meeting.status).in_(["iptal edildi", "iptal", "cancelled"])
    ).count()

    this_month_meetings_count = user_meetings.filter(
        Meeting.scheduled_start >= month_start
    ).count()

    # Toplam Süre Hesaplama
    all_user_meetings = user_meetings.all()
    total_dur_minutes = 0
    if all_user_meetings:
        total_dur_minutes = sum(
            max(15, int((m.scheduled_end - m.scheduled_start).total_seconds() / 60))
            for m in all_user_meetings
            if m.scheduled_end and m.scheduled_start
        )
    total_duration_hours = round(total_dur_minutes / 60, 1)

    # 2. Canlı (Devam Eden) Toplantı
    live_meeting_obj = user_meetings.filter(
        func.lower(Meeting.status).in_(active_statuses)
    ).order_by(Meeting.actual_start.desc(), Meeting.scheduled_start.desc()).first()

    # Eğer açıkça 'canlı' işaretli toplantı yoksa ama zamanı şu an olan bir toplantı varsa onu da canlı sayabiliriz
    if not live_meeting_obj:
        live_meeting_obj = user_meetings.filter(
            func.lower(Meeting.status).in_(["planlandı", "planlandi", "scheduled"]),
            Meeting.scheduled_start <= now,
            Meeting.scheduled_end >= now
        ).first()

    live_meeting = None
    if live_meeting_obj:
        start_str = live_meeting_obj.scheduled_start.strftime("%H:%M") if live_meeting_obj.scheduled_start else ""
        end_str = live_meeting_obj.scheduled_end.strftime("%H:%M") if live_meeting_obj.scheduled_end else ""
        
        # Real-time WebRTC Odasında (WebSocket) Anlık Bağlı Katılımcılar
        active_participants = signaling_manager.get_active_participants(live_meeting_obj.meeting_code)

        live_meeting = {
            "id": str(live_meeting_obj.id),
            "title": live_meeting_obj.title,
            "description": live_meeting_obj.description or "",
            "agenda": live_meeting_obj.agenda or live_meeting_obj.description or "Gündem belirtilmedi",
            "meeting_code": live_meeting_obj.meeting_code,
            "meeting_type": live_meeting_obj.meeting_type or "Genel Toplantı",
            "time_str": f"{start_str} - {end_str}".strip(" -"),
            "scheduled_start": live_meeting_obj.scheduled_start.isoformat() if live_meeting_obj.scheduled_start else None,
            "scheduled_end": live_meeting_obj.scheduled_end.isoformat() if live_meeting_obj.scheduled_end else None,
            "status": "CANLI",
            "passcode": live_meeting_obj.passcode,
            "passcode_required": bool(live_meeting_obj.passcode),
            "lobby_enabled": live_meeting_obj.lobby_enabled,
            "active_count": len(active_participants),
            "participants": active_participants,
            "created_by": str(live_meeting_obj.created_by)
        }

    # 3. İlk Planlı / Yaklaşan Toplantı
    exclude_ids = [live_meeting_obj.id] if live_meeting_obj else []

    next_meeting_query = user_meetings.filter(
        Meeting.id.notin_(exclude_ids),
        func.lower(Meeting.status).notin_(["tamamlandı", "tamamlandi", "completed", "ended", "iptal edildi", "iptal", "cancelled"])
    )

    # Henüz bitmemiş ilk planlı toplantıyı bul
    next_meeting_obj = next_meeting_query.filter(
        Meeting.scheduled_end >= now
    ).order_by(Meeting.scheduled_start.asc()).first()

    if not next_meeting_obj:
        next_meeting_obj = next_meeting_query.filter(
            Meeting.scheduled_start >= today_start
        ).order_by(Meeting.scheduled_start.asc()).first()

    if not next_meeting_obj:
        next_meeting_obj = next_meeting_query.order_by(Meeting.scheduled_start.asc()).first()

    next_meeting = None
    if next_meeting_obj:
        s_date = next_meeting_obj.scheduled_start
        s_time = s_date.strftime("%H:%M") if s_date else ""
        e_time = next_meeting_obj.scheduled_end.strftime("%H:%M") if next_meeting_obj.scheduled_end else ""
        
        time_prefix = ""
        if s_date:
            if s_date.date() == now.date():
                time_prefix = "Bugün "
            elif s_date.date() == (now + timedelta(days=1)).date():
                time_prefix = "Yarın "
            else:
                months_tr = {1:"Ocak", 2:"Şubat", 3:"Mart", 4:"Nisan", 5:"Mayıs", 6:"Haziran", 7:"Temmuz", 8:"Ağustos", 9:"Eylül", 10:"Ekim", 11:"Kasım", 12:"Aralık"}
                time_prefix = f"{s_date.day} {months_tr.get(s_date.month, '')} "

        next_meeting = {
            "id": str(next_meeting_obj.id),
            "title": next_meeting_obj.title,
            "meeting_code": next_meeting_obj.meeting_code,
            "time_str": f"{time_prefix}{s_time} - {e_time}".strip(),
            "location": next_meeting_obj.description or "Toplantı Odası"
        }

    # 4. Bugünkü Toplantılar Listesi
    today_meetings_objs = user_meetings.filter(
        (
            (Meeting.scheduled_start >= today_start) & (Meeting.scheduled_start < today_end)
        ) | (
            func.lower(Meeting.status).in_(active_statuses)
        )
    ).order_by(Meeting.scheduled_start.asc()).limit(10).all()

    today_list = []
    for m in today_meetings_objs:
        s_time = m.scheduled_start.strftime("%H:%M") if m.scheduled_start else ""
        e_time = m.scheduled_end.strftime("%H:%M") if m.scheduled_end else ""
        m_status = m.status or ""
        status_norm = m_status.lower()
        is_live_flag = status_norm in active_statuses
        today_list.append({
            "id": str(m.id),
            "title": m.title,
            "meeting_code": m.meeting_code,
            "time_str": f"{s_time} - {e_time}",
            "status": "CANLI" if is_live_flag else "Başlayacak"
        })

    # 5. Yaklaşan Toplantılar Listesi (Planlanmış Tüm Gelecek Toplantılar)
    upcoming_objs = user_meetings.filter(
        func.lower(Meeting.status).in_(["planlandı", "planlandi", "scheduled", "planned", "taslak"])
    ).order_by(Meeting.scheduled_start.asc()).limit(5).all()

    upcoming_list = []
    for m in upcoming_objs:
        s_str = m.scheduled_start.strftime("%d %b %H:%M") if m.scheduled_start else ""
        e_str = m.scheduled_end.strftime("%H:%M") if m.scheduled_end else ""
        upcoming_list.append({
            "id": str(m.id),
            "title": m.title,
            "meeting_code": m.meeting_code,
            "time_str": f"{s_str} - {e_str}",
            "location": m.description or "Toplantı Odası"
        })

    return {
        "total_users": total_users,
        "today_meetings": today_meetings_count,
        "upcoming_meetings": upcoming_meetings_count,
        "completed_meetings": completed_meetings_count,
        "cancelled_meetings": cancelled_meetings_count,
        "this_month_meetings": this_month_meetings_count,
        "total_duration_hours": str(total_duration_hours).replace(".", ","),
        "live_meeting": live_meeting,
        "next_meeting": next_meeting,
        "today_list": today_list,
        "upcoming_list": upcoming_list
    }
