# app/routes/analytics.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from datetime import datetime, date, timedelta
from uuid import UUID

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.meeting import Meeting
from app.models.participant_session import ParticipantSession

router = APIRouter(prefix="/analytics", tags=["Dashboard Analitik ve Grafikler"])

@router.get("/dashboard-stats")
def get_dashboard_statistics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Dashboard paneli üst kartlarını, Chart.js grafik datalarını ve 
    en aktif katılımcı leaderboard verilerini hesaplar.
    """
    today = date.today()
    now = datetime.utcnow()
    current_month = now.month
    current_year = now.year

    # 1. TEMEL SAYISAL METRİKLER (KPI CARDS)
    total_users = db.query(func.count(User.id)).scalar() or 0
    
    todays_meetings_count = db.query(func.count(Meeting.id)).filter(
        Meeting.meeting_date == today
    ).scalar() or 0

    upcoming_meetings_count = db.query(func.count(Meeting.id)).filter(
        Meeting.scheduled_start > now,
        Meeting.is_active == True
    ).scalar() or 0

    completed_meetings_count = db.query(func.count(Meeting.id)).filter(
        Meeting.status == "COMPLETED"
    ).scalar() or 0

    cancelled_meetings_count = db.query(func.count(Meeting.id)).filter(
        Meeting.status == "CANCELLED"
    ).scalar() or 0

    monthly_meetings_count = db.query(func.count(Meeting.id)).filter(
        extract('month', Meeting.scheduled_start) == current_month,
        extract('year', Meeting.scheduled_start) == current_year
    ).scalar() or 0

    # Ortalama toplantı süresi hesaplama (Tam sayı saniye / 60)
    avg_duration_query = db.query(func.avg(Meeting.actual_end - Meeting.actual_start)).filter(
        Meeting.actual_end != None, 
        Meeting.actual_start != None
    ).scalar()
    
    avg_meeting_duration = 0
    if avg_duration_query:
        # PostgreSQL interval nesnesini dakikaya çevirme
        avg_meeting_duration = round(avg_duration_query.total_seconds() / 60.0, 1)

    # 2. GRAFİK 1: AYLARA GÖRE TOPLANTI SAYISI (Çizgi Grafik Trendi - Son 6 Ay)
    monthly_trend = []
    month_names = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
    
    for i in range(5, -1, -1):
        target_date = now - timedelta(days=i*30)
        m = target_date.month
        y = target_date.year
        count = db.query(func.count(Meeting.id)).filter(
            extract('month', Meeting.scheduled_start) == m,
            extract('year', Meeting.scheduled_start) == y
        ).scalar() or 0
        
        monthly_trend.append({
            "month": month_names[m - 1],
            "count": count
        })

    # 3. GRAFİK 2: TOPLANTI TÜRLERİNE GÖRE DAĞILIM (Pasta / Donut Grafiği)
    type_counts = db.query(
        Meeting.meeting_type, func.count(Meeting.id)
    ).group_by(Meeting.meeting_type).all()
    
    # Enum veya düz string durumuna göre veriyi standardize etme
    meeting_types_distribution = [
        {"type": str(t[0]), "count": t[1]} for t in type_counts if t[0] is not None
    ]

    # 4. EN FAZLA TOPLANTIYA KATILAN KULLANICILAR (Leaderboard)
    top_participants_query = (
        db.query(
            User.first_name,
            User.last_name,
            User.email,
            func.count(ParticipantSession.id).label("attendance_count")
        )
        .join(ParticipantSession, ParticipantSession.user_id == User.id)
        .group_by(User.id, User.first_name, User.last_name, User.email)
        .order_by(func.count(ParticipantSession.id).desc())
        .limit(5)
        .all()
    )

    top_participants = [
        {
            "name": f"{p.first_name or ''} {p.last_name or ''}".strip() or p.email,
            "count": p.attendance_count
        } for p in top_participants_query
    ]

    return {
        "total_users": total_users,
        "todays_meetings_count": todays_meetings_count,
        "upcoming_meetings_count": upcoming_meetings_count,
        "completed_meetings_count": completed_meetings_count,
        "cancelled_meetings_count": cancelled_meetings_count,
        "monthly_meetings_count": monthly_meetings_count,
        "avg_meeting_duration": avg_meeting_duration,
        "charts": {
            "monthly_trend": monthly_trend,
            "meeting_types": meeting_types_distribution
        },
        "top_participants": top_participants
    }