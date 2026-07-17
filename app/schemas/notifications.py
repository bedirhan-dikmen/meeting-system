from pydantic import BaseModel, ConfigDict
from uuid import UUID
from datetime import datetime
from typing import Optional

class NotificationBase(BaseModel):
    title: str
    message: str

class NotificationOut(NotificationBase):
    id: UUID
    user_id: UUID
    is_read: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)