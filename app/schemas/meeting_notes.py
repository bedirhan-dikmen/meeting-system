from pydantic import BaseModel, ConfigDict
from uuid import UUID
from datetime import datetime
from typing import Optional

class MeetingNoteBase(BaseModel):
    content: str
    note_type: Optional[str] = "general"

class MeetingNoteCreate(MeetingNoteBase):
    meeting_id: UUID

class MeetingNoteUpdate(BaseModel):
    content: str
    note_type: Optional[str] = "general"

class MeetingNoteOut(MeetingNoteBase):
    id: UUID
    meeting_id: UUID
    author_id: Optional[UUID] = None
    note_type: str = "general"
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)