from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional

# Toplantı oluşturulurken istemciden (Frontend) beklenen şema
class MeetingCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=100, description="Toplantı Başlığı")
    description: Optional[str] = Field(None, max_length=500, description="Toplantı Açıklaması")
    scheduled_start: datetime = Field(..., description="Planlanan Başlangıç Tarihi ve Saati")
    scheduled_end: datetime = Field(..., description="Planlanan Bitiş Tarihi ve Saati")

# Toplantı güncellenirken kullanılabilecek şema
class MeetingUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=3, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    is_active: Optional[bool] = None

# API yanıtı olarak döneceğimiz, modelinle %100 eşleşen güvenli şema
class MeetingOut(BaseModel):
    id: UUID
    title: str
    description: Optional[str] = None
    scheduled_start: datetime
    scheduled_end: datetime
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None
    meeting_code: str
    is_active: bool
    created_at: datetime
    created_by: UUID

    class Config:
        from_attributes = True