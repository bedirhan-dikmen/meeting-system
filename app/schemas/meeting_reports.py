# app/schemas/meeting_reports.py
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from typing import List, Optional

class ParticipantReportRow(BaseModel):
    full_name: str
    email: str
    user_code: str
    join_time: Optional[datetime] = None
    leave_time: Optional[datetime] = None
    duration_minutes: float

class NoteReportRow(BaseModel):
    note_type: str
    author_name: str
    content: str
    created_at: datetime

class MeetingReportOut(BaseModel):
    meeting_id: UUID
    meeting_title: str
    meeting_code: str
    description: Optional[str] = None
    meeting_type: str
    manager_name: str
    scheduled_start: datetime
    scheduled_end: datetime
    actual_duration_minutes: float
    participants: List[ParticipantReportRow]
    notes: List[NoteReportRow]