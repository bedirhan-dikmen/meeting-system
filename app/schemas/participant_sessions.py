from pydantic import BaseModel, ConfigDict
from uuid import UUID
from datetime import datetime
from typing import Optional

class ParticipantSessionBase(BaseModel):
    meeting_id: UUID
    user_id: UUID

class ParticipantSessionCreate(ParticipantSessionBase):
    pass

class ParticipantSessionUpdate(BaseModel):
    joined_at: Optional[datetime] = None
    left_at: Optional[datetime] = None

class ParticipantSessionOut(ParticipantSessionBase):
    id: UUID
    joined_at: datetime
    left_at: Optional[datetime] = None
    duration_minutes: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)