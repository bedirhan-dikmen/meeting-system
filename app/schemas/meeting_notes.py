# app/schemas/meeting_notes.py
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import Optional

class MeetingNoteBase(BaseModel):
    meeting_id: UUID
    content: str = Field(..., example="Gelecek sprint için görev dağılımları netleştirildi.")
    note_type: str = Field(default="GENERAL", example="GENERAL veya DECISION")

class MeetingNoteCreate(MeetingNoteBase):
    pass

class MeetingNoteOut(MeetingNoteBase):
    id: UUID
    author_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True