from datetime import timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from datetime import datetime, date, timedelta
from typing import Dict, Any

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.meeting import Meeting
from app.models.meeting_participant import MeetingParticipant
from app.models.participant_session import ParticipantSession

from app.core.tz import get_tr_now

router = APIRouter(prefix="/dashboard", tags=["Dashboard Analitik"])

@router.get("/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Ana yönetim paneli (Dashboard) için 8 özet metrik ve 2 grafik verisini döndürür.
    """
    now = get_tr_now()
    today_start = datetime(now.year, now.month, now.day)
    today_end = today_start + timedelta(days=1)
    month_start = datetime(now.year, now.month, 1)

    # 1. Toplam kullanıcı sayısı
    total_users = db.query(func.count(User.id)).scalar() or 0

    # 2. Bugünkü toplantı sayısı
    today_meetings = db.query(func.count(Meeting.id)).filter(
        Meeting.scheduled_start >= today_start,
        Meeting.scheduled_start < today_end,
        Meeting.is_active == True
    ).scalar() or 0

    # 3. Yaklaşan toplantı sayısı
    upcoming_meetings = db.query(func.count(Meeting.id)).filter(
        Meeting.scheduled_start >= now,
        Meeting.status.in_(["planlandı", "taslak"]),
        Meeting.is_active == True
    ).scalar() or 0

    # 4. Tamamlanan toplantı sayısı
    completed_meetings = db.query(func.count(Meeting.id)).filter(
        Meeting.status == "tamamlandı",
        Meeting.is_active == True
    ).scalar() or 0

    # 5. İptal edilen toplantı sayısı
    cancelled_meetings = db.query(func.count(Meeting.id)).filter(
        Meeting.status == "iptal edildi",
        Meeting.is_active == True
    ).scalar() or 0

    # 6. Bu ay yapılan toplam toplantı
    this_month_meetings = db.query(func.count(Meeting.id)).filter(
        Meeting.scheduled_start >= month_start,
        Meeting.is_active == True
    ).scalar() or 0

    # 7. Ortalama toplantı süresi (dakika cinsinden)
    # Planlanan başlangıç ve bitiş arasındaki ortalama fark
    all_meetings = db.query(Meeting).filter(Meeting.is_active == True).all()
    if all_meetings:
        total_dur_minutes = sum(
            max(15, int((m.scheduled_end - m.scheduled_start).total_seconds() / 60))
            for m in all_meetings
        )
        avg_duration_minutes = round(total_dur_minutes / len(all_meetings), 1)
    else:
        avg_duration_minutes = 0.0

    # 8. En fazla katılan kullanıcılar (Benzersiz katıldığı toplantı sayısı ve toplam geçirdiği süre)
    users = db.query(User).filter(User.is_active == True).all()
    top_user_data = []
    
    for u in users:
        part_m_ids = db.query(MeetingParticipant.meeting_id).filter(MeetingParticipant.user_id == u.id).all()
        host_m_ids = db.query(Meeting.id).filter(Meeting.created_by == u.id).all()
        unique_m_ids = set([m_id for (m_id,) in part_m_ids] + [m_id for (m_id,) in host_m_ids])
        
        total_seconds = db.query(func.sum(ParticipantSession.duration_seconds)).filter(ParticipantSession.user_id == u.id).scalar() or 0
        total_minutes = round(total_seconds / 60)
        
        if len(unique_m_ids) > 0 or total_minutes > 0:
            user_full_name = f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email
            top_user_data.append({
                "name": user_full_name,
                "email": u.email,
                "count": len(unique_m_ids),
                "duration_minutes": total_minutes
            })

    top_user_data.sort(key=lambda x: (x["count"], x["duration_minutes"]), reverse=True)
    top_participants = top_user_data[:5]

    # GRAFİK 1: Aylara göre toplantı sayısı (Son 6 ay)
    months_labels = []
    monthly_counts = []
    current_year = now.year
    for m in range(1, 13):
        m_count = db.query(func.count(Meeting.id)).filter(
            extract('month', Meeting.scheduled_start) == m,
            extract('year', Meeting.scheduled_start) == current_year,
            Meeting.is_active == True
        ).scalar() or 0
        month_names = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
        months_labels.append(month_names[m - 1])
        monthly_counts.append(m_count)

    # GRAFİK 2: Toplantı türlerine göre dağılım
    types_query = (
        db.query(Meeting.meeting_type, func.count(Meeting.id))
        .filter(Meeting.is_active == True)
        .group_by(Meeting.meeting_type)
        .all()
    )

    type_labels = [t[0] for t in types_query] if types_query else ["Genel Toplantı", "Günlük Toplantı", "Proje Toplantısı"]
    type_counts = [t[1] for t in types_query] if types_query else [len(all_meetings), 0, 0]

    return {
        "total_users": total_users,
        "today_meetings": today_meetings,
        "upcoming_meetings": upcoming_meetings,
        "completed_meetings": completed_meetings,
        "cancelled_meetings": cancelled_meetings,
        "this_month_meetings": this_month_meetings,
        "avg_duration_minutes": avg_duration_minutes,
        "top_participants": top_participants,
        "charts": {
            "monthly": {
                "labels": months_labels,
                "data": monthly_counts
            },
            "types": {
                "labels": type_labels,
                "data": type_counts
            }
        }
    }
