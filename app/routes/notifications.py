from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.notifications import NotificationOut
from app.services import notifications as notif_service

router = APIRouter(prefix="/notifications", tags=["Bildirim Sistemi"])

@router.get("/", response_model=List[NotificationOut])
def read_my_notifications(
    unread_only: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Giriş yapmış kullanıcının bildirimlerini listeler."""
    return notif_service.get_user_notifications(db, user_id=current_user.id, unread_only=unread_only)

@router.put("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_notification_read(
    notification_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Bildirimi okundu olarak işaretler."""
    success = notif_service.mark_as_read(db, notification_id=notification_id, user_id=current_user.id)
    if not success:
        raise HTTPException(
            status_code=404,
            detail="Bildirim bulunamadı veya bu işlem için yetkiniz yok."
        )