from pydantic import BaseModel, ConfigDict
from uuid import UUID
from datetime import datetime, date  # PureDate yerine standart date import ettik
from typing import Optional

class MeetingActionBase(BaseModel):
    title: str
    description: Optional[str] = None
    assigned_to: Optional[UUID] = None  # Görevin atandığı kullanıcı UUID'si
    due_date: Optional[date] = None    # Tip tanımını date olarak güncelledik

class MeetingActionCreate(MeetingActionBase):
    meeting_id: UUID

class MeetingActionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    assigned_to: Optional[UUID] = None
    due_date: Optional[date] = None   # Tip tanımını date olarak güncelledik
    is_completed: Optional[bool] = None

class MeetingActionOut(MeetingActionBase):
    id: UUID
    meeting_id: UUID
    created_by: UUID
    is_completed: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)