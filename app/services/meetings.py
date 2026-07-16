from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional, List
import secrets

from app.models.meeting import Meeting
from app.schemas.meetings import MeetingCreate, MeetingUpdate

def generate_unique_meeting_code() -> str:
    """WebRTC sinyalleşme odaları için benzersiz kod üretir."""
    part1 = "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(4))
    part2 = "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(4))
    return f"yeb-{part1}-{part2}"

def create_new_meeting(db: Session, meeting_data: MeetingCreate, host_id: UUID) -> Meeting:
    """Model parametrelerine tam uyumlu toplantı kaydı oluşturur."""
    while True:
        code = generate_unique_meeting_code()
        existing = db.query(Meeting).filter(Meeting.meeting_code == code).first()
        if not existing:
            break

    db_meeting = Meeting(
        title=meeting_data.title,
        description=meeting_data.description,
        scheduled_start=meeting_data.scheduled_start,
        scheduled_end=meeting_data.scheduled_end,
        meeting_code=code,
        created_by=host_id,
        is_active=True
    )
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    return db_meeting

def get_meetings_list(db: Session, skip: int = 0, limit: int = 100) -> List[Meeting]:
    """Sistemdeki aktif toplantıları listeler."""
    return db.query(Meeting).filter(Meeting.is_active == True).offset(skip).limit(limit).all()

def get_meeting_by_id(db: Session, meeting_id: UUID) -> Optional[Meeting]:
    """UUID ile spesifik bir toplantıyı çeker."""
    return db.query(Meeting).filter(Meeting.id == meeting_id).first()

def get_meeting_by_code(db: Session, code: str) -> Optional[Meeting]:
    """Oda kodu ile spesifik bir toplantıyı çeker."""
    return db.query(Meeting).filter(Meeting.meeting_code == code).first()

def update_meeting_details(db: Session, meeting_id: UUID, update_data: MeetingUpdate) -> Optional[Meeting]:
    """Toplantı bilgilerini günceller."""
    db_meeting = get_meeting_by_id(db, meeting_id)
    if not db_meeting:
        return None
    
    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(db_meeting, key, value)
        
    db.commit()
    db.refresh(db_meeting)
    return db_meeting