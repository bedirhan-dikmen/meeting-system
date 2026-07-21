# app/schemas/notifications.py
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime

class NotificationOut(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    message: str
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True