# app/schemas/meetings.py
from pydantic import BaseModel, Field
from datetime import datetime, date
from uuid import UUID
from typing import Optional

class MeetingBase(BaseModel):
    title: str
    description: Optional[str] = None
    agenda: Optional[str] = None
    meeting_date: Optional[date] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    meeting_type: Optional[str] = "GENERAL"
    status: Optional[str] = "SCHEDULED"

class MeetingCreate(BaseModel):
    title: str
    description: Optional[str] = None
    agenda: Optional[str] = None
    meeting_date: Optional[date] = None
    scheduled_start: datetime
    scheduled_end: datetime
    meeting_type: Optional[str] = "GENERAL"
    status: Optional[str] = "SCHEDULED"

class MeetingOut(BaseModel):
    id: UUID
    meeting_code: str
    title: str
    description: Optional[str] = None
    agenda: Optional[str] = None
    meeting_date: Optional[date] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None
    meeting_type: Optional[str] = "GENERAL"
    status: Optional[str] = "SCHEDULED"
    is_active: bool = True
    created_by: UUID
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True