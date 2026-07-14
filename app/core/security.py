# app/core/security.py
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from datetime import datetime, timedelta
from typing import Any, Union
from jose import jwt, JWTError
from passlib.context import CryptContext
from app.core.config import settings
import bcrypt

# bcrypt algoritması ile şifre hashleme nesnesi
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Kullanıcın girdiği şifre ile DB'deki hash'li şifreyi karşılaştırır."""
    try:
        # bcrypt byte formatında çalıştığı için string değerleri encode ediyoruz
        password_bytes = plain_password.encode('utf-8')
        hashed_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except Exception:
        return False
    
def get_password_hash(password: str) -> str:
    """Yeni şifreleri hash'leyerek DB'ye kaydetmeye hazır hale getirir."""
    password_bytes = password.encode('utf-8')
    # Tuz (Salt) üreterek şifreyi hash'liyoruz
    salt = bcrypt.gensalt()
    hashed_bytes = bcrypt.hashpw(password_bytes, salt)
    return hashed_bytes.decode('utf-8')

def create_access_token(subject: Union[str, Any], role: str, expires_delta: timedelta = None) -> str:
    """
    Kullanıcıya özel JWT Access Token üretir.
    Token içerisine kullanıcının ID'sini (sub) ve rolünü (role) gömeriz.
    """
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    # Token payload (içerik) bilgisi
    to_encode = {
        "exp": expire,
        "sub": str(subject),
        "role": role  # RBAC (Rol tabanlı yetkilendirme) için rol bilgisini ekliyoruz
    }
    
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

# FastAPI'ın Swagger arayüzünde "Authorize" kilidini aktifleştiren nesne
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")

def get_current_user_claims(token: str = Depends(oauth2_scheme)) -> dict:
    """JWT Token'ı çözer ve içindeki bilgileri (claims) döner."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Geçersiz veya süresi dolmuş kimlik doğrulama token'ı.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        role: str = payload.get("role")
        if user_id is None or role is None:
            raise credentials_exception
        return {"user_id": user_id, "role": role}
    except JWTError:
        raise credentials_exception

def verify_admin_role(claims: dict = Depends(get_current_user_claims)):
    """Sadece yönetici (admin) rolündeki isteklerin geçmesine izin verir."""
    if claims.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu işlemi gerçekleştirmek için yönetici (admin) yetkiniz bulunmalıdır."
        )
    return claims