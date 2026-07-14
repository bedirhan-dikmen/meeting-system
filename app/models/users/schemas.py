# app/modules/users/schemas.py
from datetime import datetime
from pydantic import BaseModel, EmailStr
from typing import Optional
from uuid import UUID


# Departman Yanıt Şeması
class DepartmentBase(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True

# Kullanıcı Ortak Alanları
class UserBase(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    user_code: Optional[str] = None
    role: str = "user"  # admin, user
    is_active: bool = True
    department_id: Optional[int] = None

# Kullanıcı Oluşturma İsteği (Request)
class UserCreate(UserBase):
    password: str

# Kullanıcı Güncelleme İsteği (Request)
class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    department_id: Optional[int] = None
    password: Optional[str] = None  # Şifre güncellenmek istenirse

# Kullanıcı Detay Yanıtı (Response)
class UserResponse(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    email: EmailStr
    user_code: Optional[str] = None
    role: str
    is_active: bool
    created_at: datetime
    department: Optional[DepartmentBase] = None

    class Config:
        from_attributes = True