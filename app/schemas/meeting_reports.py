from pydantic import BaseModel, ConfigDict
from uuid import UUID
from datetime import datetime, date
from typing import List, Optional

class ParticipantTimeSummary(BaseModel):
    user_id: UUID
    first_name: str
    last_name: str
    user_code: str
    total_active_minutes: float
    total_sessions: int

class ReportNoteOut(BaseModel):
    id: UUID
    author_name: str
    content: str
    created_at: datetime

class MeetingReportOut(BaseModel):
    meeting_id: UUID
    meeting_title: str
    meeting_code: str
    scheduled_start: datetime
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None
    actual_duration_minutes: float
    total_participants_count: int
    total_notes_count: int
    agenda: Optional[str] = None

    participants_summary: List[ParticipantTimeSummary]
    notes: List[ReportNoteOut]

    model_config = ConfigDict(from_attributes=True)