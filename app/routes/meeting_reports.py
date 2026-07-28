from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from uuid import UUID
from app.core.database import get_db
from app.core.security import get_current_user, verify_meeting_access
from app.models.user import User
from app.schemas.meeting_reports import MeetingReportOut
from app.services import meeting_reports as report_service
from app.services.webhooks import trigger_webhook_event

router = APIRouter(prefix="/reports", tags=["Toplantı Analitik ve Raporlama"])

@router.get("/meeting/{meeting_id}", response_model=MeetingReportOut)
def get_meeting_report(
    meeting_id: UUID,
    background_tasks: BackgroundTasks,
    export: Optional[str] = Query(None, description="İleride çıktı formatı için: 'pdf' veya 'excel'"),
    db: Session = Depends(get_db),
    access_claims: dict = Depends(verify_meeting_access)
):
    """Toplantıya ait katılım sürelerini, notları ve aksiyon kararlarını içeren özet raporu getirir."""
    report_data = report_service.generate_meeting_report_data(db, meeting_id=meeting_id)
    if not report_data:
        raise HTTPException(
            status_code=404, 
            detail="Toplantı bulunamadı veya rapor üretilecek veri yok."
        )
    
    user_id_str = access_claims.get("user_id", "guest")
    trigger_webhook_event(
        db=db,
        event_name="meeting.report_generated",
        payload={"meeting_id": str(meeting_id), "generated_by": user_id_str},
        background_tasks=background_tasks
    )

    return report_data