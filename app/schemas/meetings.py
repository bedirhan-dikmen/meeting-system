from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime
from uuid import UUID
from typing import Optional, List, Union

# Toplantı oluşturulurken istemciden (Frontend) beklenen şema
class MeetingCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=100, description="Toplantı Başlığı")
    description: Optional[str] = Field(None, max_length=500, description="Toplantı Açıklaması")
    scheduled_start: datetime = Field(..., description="Planlanan Başlangıç Tarihi ve Saati")
    scheduled_end: Optional[datetime] = Field(None, description="Planlanan Bitiş Tarihi ve Saati")
    duration_minutes: Optional[int] = Field(30, description="Varsayılan Süre (Dakika)")
    meeting_type: Optional[str] = Field("Genel Toplantı", description="Toplantı Türü (Anlık Toplantı, Planlı Toplantı, Departman Görüşmesi, Eğitim)")
    agenda: Optional[str] = Field(None, description="Toplantı Gündemi")
    status: Optional[str] = Field("planlandı", description="Toplantı Durumu")
    passcode: Optional[str] = Field(None, description="Oda Katılım Şifresi")
    lobby_enabled: Optional[bool] = Field(False, description="Bekleme Odası / Lobi Durumu")
    is_private: Optional[bool] = Field(False, description="Sadece Davetliler Katılabilir mi?")
    invited_user_ids: Optional[List[Union[UUID, str]]] = Field(default=[], description="Davet Edilen Kullanıcı ID Listesi")

# Toplantı güncellenirken kullanılabilecek şema
class MeetingUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=3, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    meeting_type: Optional[str] = None
    agenda: Optional[str] = None
    status: Optional[str] = None
    passcode: Optional[str] = None
    lobby_enabled: Optional[bool] = None
    is_private: Optional[bool] = None
    is_active: Optional[bool] = None

# API yanıtı olarak döneceğimiz, modelinle %100 eşleşen güvenli şema
class MeetingOut(BaseModel):
    id: UUID
    title: str
    description: Optional[str] = None
    scheduled_start: datetime
    scheduled_end: Optional[datetime] = None
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None
    meeting_code: str
    meeting_type: Optional[str] = "Genel Toplantı"
    agenda: Optional[str] = None
    status: Optional[str] = "planlandı"
    passcode: Optional[str] = None
    lobby_enabled: Optional[bool] = False
    is_private: Optional[bool] = False
    is_active: Optional[bool] = True
    created_at: Optional[datetime] = None
    created_by: UUID
    active_count: Optional[int] = 0
    active_participants: Optional[List[dict]] = []
    time_str: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)