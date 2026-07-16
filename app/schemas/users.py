# app/schemas/users.py
from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional

class UserBase(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    user_code: Optional[str] = None
    role: str = "user"
    department_id: Optional[int] = None

class UserCreate(UserBase):
    password: str

# UPDATE ŞEMASI: Güncelleme esnasında şifre dahil tüm alanlar opsiyoneldir
class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    user_code: Optional[str] = None
    role: Optional[str] = None
    department_id: Optional[int] = None
    password: Optional[str] = None  # Şifre güncellenmek istenirse
    is_active: Optional[bool] = None

class UserOut(UserBase):
    id: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True