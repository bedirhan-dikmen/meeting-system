from pydantic import BaseModel, EmailStr, Field
from datetime import datetime
from typing import Optional
from uuid import UUID

class UserBase(BaseModel):
    first_name: str = Field(..., min_length=2, max_length=50)
    last_name: str = Field(..., min_length=2, max_length=50)
    email: EmailStr = Field(...)
    user_code: str = Field(..., min_length=3, max_length=20)
    role: str = Field("user") # "admin" veya "user"
    avatar_url: Optional[str] = None
    department_id: Optional[int] = Field(None)

class UserCreate(UserBase):
    password: str = Field(..., min_length=6)

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    user_code: Optional[str] = None
    role: Optional[str] = None
    avatar_url: Optional[str] = None
    department_id: Optional[int] = None
    password: Optional[str] = None  # Şifre güncellenmek istenirse süzülecek
    is_active: Optional[bool] = None

class UserProfileUpdate(BaseModel):
    first_name: Optional[str] = Field(None, min_length=2, max_length=50)
    last_name: Optional[str] = Field(None, min_length=2, max_length=50)
    email: Optional[EmailStr] = None
    user_code: Optional[str] = Field(None, min_length=3, max_length=20)
    current_password: Optional[str] = None
    new_password: Optional[str] = Field(None, min_length=6)

class UserOut(UserBase):
    id: UUID
    is_active: bool
    created_at: datetime

    model_config = {
        "from_attributes": True  # Pydantic v2 standartlarında SQLAlchemy objelerini dict'e dönüştürür
    }