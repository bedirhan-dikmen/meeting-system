from pydantic import BaseModel, ConfigDict, HttpUrl
from uuid import UUID
from datetime import datetime
from typing import List, Optional

class WebhookSubscriptionBase(BaseModel):
    target_url: str
    events: List[str]  # ['meeting.ended', 'action.created'] gibi event listesi

class WebhookSubscriptionCreate(WebhookSubscriptionBase):
    pass

class WebhookSubscriptionOut(WebhookSubscriptionBase):
    id: UUID
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class ApiKeyOut(BaseModel):
    id: UUID
    key_name: str
    prefix: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)