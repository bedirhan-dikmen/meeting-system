from sqlalchemy import select
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime
from typing import List, Optional
from app.models.meeting_action import MeetingAction
from app.services.notifications import create_notification  # Bildirim servisini import edildi

def create_action(db: Session, action_data: any, creator_id: UUID) -> MeetingAction:
    """Toplantıda alınan yeni bir aksiyon kararını kaydeder."""
    db_action = MeetingAction(
        meeting_id=action_data.meeting_id,
        created_by=creator_id,
        title=action_data.title,
        description=action_data.description,
        assigned_to=action_data.assigned_to,
        due_date=action_data.due_date,
        is_completed=False,
        created_at=datetime.utcnow()
    )
    db.add(db_action)
    db.commit()
    db.refresh(db_action)
    # EĞER GÖREV BİRİNE ATANDIYSA O KULLANICIYA OTOMATİK BİLDİRİM GÖNDER!
    if db_action.assigned_to:
        create_notification(
            db=db,
            user_id=db_action.assigned_to,
            title="Yeni Bir Görev Atandı!",
            message=f"'{db_action.title}' başlıklı görev size atandı. Son teslim tarihi: {db_action.due_date or 'Belirtilmedi'}."
        )
    
    return db_action

def get_meeting_actions(db: Session, meeting_id: UUID) -> List[MeetingAction]:
    """Bir toplantıya ait tüm aksiyon kararlarını listeler."""
    stmt = select(MeetingAction).where(MeetingAction.meeting_id == meeting_id)
    return list(db.scalars(stmt).all())

def update_action_status(db: Session, action_id: UUID, is_completed: bool) -> Optional[MeetingAction]:
    """Bir aksiyon kararının tamamlanma durumunu günceller."""
    db_action = db.get(MeetingAction, action_id)
    if not db_action:
        return None
    db_action.is_completed = is_completed
    db.commit()
    db.refresh(db_action)
    return db_action