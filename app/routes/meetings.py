# app/routes/meetings.py
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from uuid import UUID

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.meetings import MeetingCreate, MeetingOut, MeetingUpdate
from app.models.enums import MeetingType, MeetingStatus
import app.services.meetings as meeting_service

router = APIRouter(prefix="/meetings", tags=["Kurumsal Toplantı Yönetimi"])

@router.post("/", response_model=MeetingOut, status_code=status.HTTP_201_CREATED)
def create_meeting(
    payload: MeetingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Yeni bir kurumsal toplantı planlar (Yalnızca yetkili kullanıcılar)."""
    host_id = getattr(current_user, "id", None)
    if not host_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Kimlik doğrulama başarısız.")
    return meeting_service.create_new_meeting(db, meeting_data=payload, host_id=host_id)

@router.get("/", response_model=List[MeetingOut])
def read_meetings(
    search: Optional[str] = Query(None, description="Başlık veya kod ile arama"),
    meeting_type: Optional[MeetingType] = Query(None, description="Toplantı türü filtresi"),
    status: Optional[MeetingStatus] = Query(None, description="Toplantı durum filtresi"),
    target_date: Optional[date] = Query(None, description="Belirli tarih filtresi"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Dashboard tablosundaki gelişmiş arama ve filtreleme motorunu besler."""
    return meeting_service.get_filtered_meetings_list(
        db, search=search, meeting_type=meeting_type, status=status, target_date=target_date
    )

@router.get("/code/{meeting_code}", response_model=MeetingOut)
def read_meeting_by_code(
    meeting_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Lobi ve önizleme ekranlarında oda koduna göre doğrulama yapar."""
    meeting = meeting_service.get_meeting_by_code(db, code=meeting_code)
    if not meeting:
        raise HTTPException(status_code=404, detail="Geçersiz veya süresi dolmuş toplantı kodu.")
    return meeting

@router.put("/{meeting_id}", response_model=MeetingOut)
def update_meeting(
    meeting_id: UUID,
    payload: MeetingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Toplantıyı başlatır, sonlandırır veya künye bilgilerini günceller."""
    meeting = meeting_service.get_meeting_by_id(db, meeting_id=meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Toplantı bulunamadı.")
        
    # Güvenlik Kontrolü: Sadece toplantı sahibi veya admin güncelleyebilir
    if meeting.created_by != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Bu toplantıyı güncelleme yetkiniz yok.")
        
    return meeting_service.update_meeting_details(db, meeting=meeting, update_data=payload)