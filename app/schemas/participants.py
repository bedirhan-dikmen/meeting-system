from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import Optional

class MeetingParticipantBase(BaseModel):
    meeting_id: UUID = Field(..., description="Katılımcının ekleneceği toplantının UUID'si")
    user_id: UUID = Field(..., description="Davet edilen kullanıcının UUID'si")
    role: str = Field(default="listener", description="Odadaki rolü (host, co_host, speaker, listener)")

class MeetingParticipantCreate(MeetingParticipantBase):
    pass

class MeetingParticipantUpdate(BaseModel):
    role: Optional[str] = Field(None, description="Odadaki rolünü güncelle: host, co_host, speaker, listener")
    status: Optional[str] = Field(None, description="Katılım durumunu güncelle: invited, joined, left, banned")

class MeetingParticipantOut(MeetingParticipantBase):
    id: UUID
    status: str
    joined_at: Optional[datetime] = None
    left_at: Optional[datetime] = None

    class Config:
        from_attributes = True