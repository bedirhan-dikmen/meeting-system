from sqlalchemy import select, update
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List, Optional
from app.models.notification import Notification

def create_notification(db: Session, user_id: UUID, title: str, message: str, meeting_code: Optional[str] = None) -> Notification:
    """Sistem içinde bir kullanıcıya bildirim oluşturur."""
    db_notif = Notification(
        user_id=user_id,
        title=title,
        message=message,
        meeting_code=meeting_code,
        is_read=False
    )
    db.add(db_notif)
    db.commit()
    db.refresh(db_notif)
    return db_notif

def get_user_notifications(db: Session, user_id: UUID, unread_only: bool = False) -> List[Notification]:
    """Kullanıcının tüm veya sadece okunmamış bildirimlerini getirir."""
    stmt = select(Notification).where(Notification.user_id == user_id)
    if unread_only:
        stmt = stmt.where(Notification.is_read == False)
    stmt = stmt.order_by(Notification.created_at.desc())
    return list(db.scalars(stmt).all())

def mark_as_read(db: Session, notification_id: UUID, user_id: UUID) -> bool:
    """Belirli bir bildirimi okundu olarak işaretler."""
    db_notif = db.get(Notification, notification_id)
    if not db_notif or db_notif.user_id != user_id:
        return False
    db_notif.is_read = True
    db.commit()
    return True

def delete_notification(db: Session, notification_id: UUID, user_id: UUID) -> bool:
    """Belirli bir bildirimi veritabanından siler."""
    db_notif = db.get(Notification, notification_id)
    if not db_notif or db_notif.user_id != user_id:
        return False
    db.delete(db_notif)
    db.commit()
    return True

def delete_all_user_notifications(db: Session, user_id: UUID) -> int:
    """Kullanıcının tüm bildirimlerini temizler/siler."""
    deleted_count = db.query(Notification).filter(Notification.user_id == user_id).delete()
    db.commit()
    return deleted_count