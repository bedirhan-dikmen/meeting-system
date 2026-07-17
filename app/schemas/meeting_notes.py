from pydantic import BaseModel, ConfigDict
from uuid import UUID
from datetime import datetime
from typing import Optional

class MeetingNoteBase(BaseModel):
    content: str

class MeetingNoteCreate(MeetingNoteBase):
    meeting_id: UUID

class MeetingNoteUpdate(BaseModel):
    content: str

class MeetingNoteOut(MeetingNoteBase):
    id: UUID
    meeting_id: UUID
    author_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)