from pydantic import BaseModel, ConfigDict
from uuid import UUID
from datetime import datetime
from typing import Optional

class NotificationBase(BaseModel):
    title: str
    message: str
    meeting_code: Optional[str] = None

class NotificationOut(NotificationBase):
    id: UUID
    user_id: UUID
    meeting_code: Optional[str] = None
    is_read: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)