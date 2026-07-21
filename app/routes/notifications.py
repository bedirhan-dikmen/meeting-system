# app/routes/notifications.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List

from app.core.database import get_db
from app.core.security import get_current_user
from app.schemas.notifications import NotificationOut
from app.services import notifications as notif_service

router = APIRouter(prefix="/notifications", tags=["Bildirim Sistemi"])

@router.get("/", response_model=List[NotificationOut])
def read_my_notifications(
    unread_only: bool = False,
    db: Session = Depends(get_db),
    current_user: any = Depends(get_current_user)
):
    """Giriş yapmış güncel kullanıcının tüm veya sadece okunmamış bildirimlerini listeler."""
    user_id = getattr(current_user, "id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Kimlik doğrulanamadı.")
        
    return notif_service.get_user_notifications(db, user_id=user_id, unread_only=unread_only)

@router.put("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_notification_read(
    notification_id: UUID,
    db: Session = Depends(get_db),
    current_user: any = Depends(get_current_user)
):
    """Gelen bir bildiriyi okundu olarak işaretler ve veritabanını günceller."""
    user_id = getattr(current_user, "id", None)
    success = notif_service.mark_as_read(db, notification_id=notification_id, user_id=user_id)
    if not success:
        raise HTTPException(
            status_code=404,
            detail="Bildirim bulunamadı veya bu işlem için yetkiniz yok."
        )
    return status.HTTP_204_NO_CONTENT