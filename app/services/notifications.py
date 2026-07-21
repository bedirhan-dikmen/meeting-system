# app/services/notifications.py
from sqlalchemy import select
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List
from app.models.notification import Notification

def create_notification(db: Session, user_id: UUID, title: str, message: str) -> Notification:
    """Sistem içi tetiklenen olaylar için (Davet, İptal, Atama) yeni bildirim basar."""
    db_notif = Notification(
        user_id=user_id,
        title=title,
        message=message,
        is_read=False
    )
    db.add(db_notif)
    db.commit()
    db.refresh(db_notif)
    return db_notif

def get_user_notifications(db: Session, user_id: UUID, unread_only: bool = False) -> List[Notification]:
    """Kullanıcının gelen kutusundaki tüm veya okunmamış bildirimleri çeker."""
    stmt = select(Notification).where(Notification.user_id == user_id)
    if unread_only:
        stmt = stmt.where(Notification.is_read == False)
    stmt = stmt.order_by(Notification.created_at.desc())
    return list(db.scalars(stmt).all())

def mark_as_read(db: Session, notification_id: UUID, user_id: UUID) -> bool:
    """Gelen bildiriyi okundu durumuna getirerek mühürler."""
    db_notif = db.get(Notification, notification_id)
    if not db_notif or db_notif.user_id != user_id:
        return False
        
    db_notif.is_read = True
    db.commit()
    return True