# app/routes/meetings.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.meetings import MeetingCreate, MeetingOut, MeetingUpdate
from app.services.meetings import (
    create_new_meeting,
    get_meetings_list,
    get_meeting_by_id,
    get_meeting_by_code,
    update_meeting_details
)

router = APIRouter()

@router.post("/", response_model=MeetingOut, status_code=status.HTTP_201_CREATED)
def create_meeting(
    payload: MeetingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Sisteme giriş yapmış kullanıcının (Host) yeni bir toplantı planlamasını sağlar."""
    # created_by UUID tabanlı olduğu için user.id'yi doğrudan güvenle UUID olarak aktarıyoruz
    host_id = getattr(current_user, "id", None)
    if not host_id:
        raise HTTPException(status_code=401, detail="Kullanıcı kimliği doğrulanamadı.")
    return create_new_meeting(db, meeting_data=payload, host_id=host_id)

@router.get("/", response_model=List[MeetingOut])
def read_meetings(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Sistemdeki aktif toplantıları listeler."""
    return get_meetings_list(db, skip=skip, limit=limit)

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
def update_meeting(
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
    
    # Sadece toplantıyı oluşturan (created_by) veya admin güncelleyebilir
    if meeting.created_by != user_id and user_role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu toplantıyı güncelleme yetkiniz bulunmuyor."
        )
        
    updated_meeting = update_meeting_details(db, meeting_id=meeting_id, update_data=payload)
    return updated_meeting