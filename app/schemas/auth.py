# app/schemas/auth.py
from pydantic import BaseModel, EmailStr

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class ExternalLoginRequest(BaseModel):
    user_code: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    role: str