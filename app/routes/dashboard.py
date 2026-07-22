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

router = APIRouter(prefix="/dashboard", tags=["Dashboard Analitik"])

@router.get("/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Ana yönetim paneli (Dashboard) için 8 özet metrik ve 2 grafik verisini döndürür.
    """
    now = datetime.now(timezone.utc)
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

    # 8. En fazla toplantıya katılan kullanıcılar (Top 5)
    top_user_query = (
        db.query(
            User.first_name,
            User.last_name,
            User.email,
            func.count(ParticipantSession.id).label("session_count")
        )
        .join(ParticipantSession, ParticipantSession.user_id == User.id)
        .group_by(User.id, User.first_name, User.last_name, User.email)
        .order_by(func.count(ParticipantSession.id).desc())
        .limit(5)
        .all()
    )

    top_participants = [
        {
            "name": f"{u[0]} {u[1]}",
            "email": u[2],
            "count": u[3]
        }
        for u in top_user_query
    ]

    # Fallback if no sessions yet: show users with created meetings count
    if not top_participants:
        top_creators = (
            db.query(
                User.first_name,
                User.last_name,
                User.email,
                func.count(Meeting.id).label("meeting_count")
            )
            .join(Meeting, Meeting.created_by == User.id)
            .group_by(User.id, User.first_name, User.last_name, User.email)
            .order_by(func.count(Meeting.id).desc())
            .limit(5)
            .all()
        )
        top_participants = [
            {
                "name": f"{u[0]} {u[1]}",
                "email": u[2],
                "count": u[3]
            }
            for u in top_creators
        ]

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
