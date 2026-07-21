# app/schemas/participants.py
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from typing import Optional

class MeetingParticipantBase(BaseModel):
    meeting_id: UUID
    user_id: UUID
    role: str = "participant"
    status: str = "pending"

class MeetingParticipantCreate(MeetingParticipantBase):
    pass

class MeetingParticipantUpdate(BaseModel):
    role: Optional[str] = None
    status: Optional[str] = None

class MeetingParticipantOut(MeetingParticipantBase):
    id: UUID
    invited_at: datetime
    joined_at: Optional[datetime] = None

    class Config:
        from_attributes = True