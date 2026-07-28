from pydantic import BaseModel, Field, ConfigDict
from uuid import UUID
from datetime import datetime
from typing import Optional

class MeetingParticipantBase(BaseModel):
    meeting_id: UUID = Field(..., description="Katılımcının ekleneceği toplantının UUID'si")
    user_id: UUID = Field(..., description="Davet edilen kullanıcının UUID'si")
    role: Optional[str] = Field(default="participant", description="Odadaki rolü (moderator, host, co_host, speaker, participant, guest)")

class MeetingParticipantCreate(MeetingParticipantBase):
    pass

class MeetingParticipantUpdate(BaseModel):
    role: Optional[str] = Field(None, description="Odadaki rolünü güncelle: moderator, participant, guest")
    status: Optional[str] = Field(None, description="Katılım durumunu güncelle: PENDING_APPROVAL, APPROVED, REJECTED, pending, accepted, declined, joined, left")

class MeetingParticipantOut(MeetingParticipantBase):
    id: UUID
    status: Optional[str] = "pending"
    joined_at: Optional[datetime] = None
    invited_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)