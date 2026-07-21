# app/schemas/participant_sessions.py
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from typing import Optional

class ParticipantSessionBase(BaseModel):
    meeting_id: UUID
    user_id: UUID

class ParticipantSessionCreate(ParticipantSessionBase):
    pass

class ParticipantSessionOut(ParticipantSessionBase):
    id: UUID
    joined_at: datetime
    left_at: Optional[datetime] = None
    duration_seconds: int

    class Config:
        from_attributes = True