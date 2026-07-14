# app/modules/auth/schemas.py
from pydantic import BaseModel, EmailStr

# 1. Normal Giriş İsteği Şeması (Admin ve İç Personel için)
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

# 2. Harici Sistem Giriş İsteği Şeması (Kullanıcı Kodu ile)
class ExternalLoginRequest(BaseModel):
    user_code: str
    password: str

# 3. Giriş Başarılı Olduğunda Dönülecek Yanıt Şeması
class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
