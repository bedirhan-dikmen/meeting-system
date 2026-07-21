# app/services/meetings.py
import uuid
import random
import string
from sqlalchemy.orm import Session
from sqlalchemy import select, or_, extract
from datetime import date, datetime
from uuid import UUID
from typing import List, Optional
from app.models.meeting import Meeting
from app.models.enums import MeetingType, MeetingStatus
from app.schemas.meetings import MeetingCreate, MeetingUpdate

def generate_unique_meeting_code(db: Session) -> str:
    """Benzersiz ve kurumsal formatta yeb-xxxx-xxxx formatında oda kodu üretir."""
    while True:
        part1 = ''.join(random.choices(string.ascii_lowercase, k=4))
        part2 = ''.join(random.choices(string.ascii_lowercase, k=4))
        code = f"yeb-{part1}-{part2}"
        
        # Kodun eşsizliğini kontrol et
        exists = db.query(Meeting).filter(Meeting.meeting_code == code).first()
        if not exists:
            return code

def create_new_meeting(db: Session, meeting_data: MeetingCreate, host_id: UUID) -> Meeting:
    """Yeni bir kurumsal toplantı odası planlar ve veritabanına mühürler."""
    db_meeting = Meeting(
        title=meeting_data.title,
        description=meeting_data.description,
        agenda=meeting_data.agenda,
        meeting_date=meeting_data.meeting_date,
        scheduled_start=meeting_data.scheduled_start,
        scheduled_end=meeting_data.scheduled_end,
        meeting_type=meeting_data.meeting_type,
        status=meeting_data.status,
        meeting_code=generate_unique_meeting_code(db),
        created_by=host_id,
        is_active=True
    )
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    return db_meeting

def get_filtered_meetings_list(
    db: Session, 
    search: Optional[str] = None, 
    meeting_type: Optional[MeetingType] = None, 
    status: Optional[MeetingStatus] = None, 
    target_date: Optional[date] = None
) -> List[Meeting]:
    """Gelişmiş arama ve dashboard filtreleme kriterlerine göre toplantıları listeler."""
    stmt = select(Meeting)
    
    if search:
        search_filter = f"%{search}%"
        stmt = stmt.where(or_(Meeting.title.ilike(search_filter), Meeting.meeting_code.ilike(search_filter)))
        
    if meeting_type:
        stmt = stmt.where(Meeting.meeting_type == meeting_type)
        
    if status:
        stmt = stmt.where(Meeting.status == status)
        
    if target_date:
        stmt = stmt.where(Meeting.meeting_date == target_date)
        
    stmt = stmt.order_by(Meeting.scheduled_start.desc())
    return list(db.scalars(stmt).all())

def get_meeting_by_id(db: Session, meeting_id: UUID) -> Optional[Meeting]:
    return db.get(Meeting, meeting_id)

def get_meeting_by_code(db: Session, code: str) -> Optional[Meeting]:
    return db.query(Meeting).filter(Meeting.meeting_code == code).first()

def update_meeting_details(db: Session, meeting: Meeting, update_data: MeetingUpdate) -> Meeting:
    """Toplantı durumunu, gerçek başlangıç/bitiş saatlerini ve künyesini günceller."""
    update_dict = update_data.model_dump(exclude_unset=True)
    
    # Eğer durum IN_PROGRESS (Başladı) yapılıyorsa ve actual_start yoksa anı mühürle
    if update_dict.get("status") == MeetingStatus.IN_PROGRESS and not meeting.actual_start:
        meeting.actual_start = datetime.utcnow()
        
    # Eğer durum COMPLETED (Tamamlandı) yapılıyorsa ve actual_end yoksa anı mühürle
    if update_dict.get("status") == MeetingStatus.COMPLETED and not meeting.actual_end:
        meeting.actual_end = datetime.utcnow()
        meeting.is_active = False

    for key, value in update_dict.items():
        setattr(meeting, key, value)
        
    db.commit()
    db.refresh(meeting)
    return meeting