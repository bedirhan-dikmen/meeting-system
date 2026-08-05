from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader, OAuth2PasswordBearer
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Union
from jose import jwt, JWTError
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from app.core.config import settings
from uuid import UUID
import bcrypt

from app.core.database import get_db
from app.models.user import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        password_bytes = plain_password.encode('utf-8')
        hashed_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed_bytes = bcrypt.hashpw(password_bytes, salt)
    return hashed_bytes.decode('utf-8')

# Legacy Alias
hash_password = get_password_hash

def create_access_token(subject: Union[str, Any], role: str, expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)


    to_encode = {
        "exp": expire,
        "sub": str(subject),
        "role": role
    }
    
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

def create_guest_token(meeting_id: Union[UUID, str], guest_name: str, guest_id: Optional[str] = None, duration_minutes: int = 240, meeting_code: Optional[str] = None) -> str:
    """Misafir (Guest) için kısa süreli JWT access token üretir."""
    import uuid as _uuid
    expire = datetime.now(timezone.utc) + timedelta(minutes=duration_minutes)
    g_id = guest_id or f"guest_{_uuid.uuid4().hex[:12]}"
    to_encode = {
        "sub": g_id,
        "guest_id": g_id,
        "role": "guest",
        "meeting_id": str(meeting_id),
        "meeting_code": meeting_code,
        "guest_name": guest_name,
        "exp": expire
    }
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login", auto_error=False)

from fastapi import Request

def get_current_user_claims(
    request: Request = None,
    token: Optional[str] = Depends(oauth2_scheme_optional)
) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Geçersiz veya süresi dolmuş kimlik doğrulama token'ı.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token and request:
        token = request.cookies.get("access_token")
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: Optional[str] = payload.get("sub")
        role: Optional[str] = payload.get("role")
        if user_id is None or role is None:
            raise credentials_exception
        return {"user_id": user_id, "role": role}
    except JWTError:
        raise credentials_exception
    
def get_current_user(
    claims: Optional[dict] = Depends(get_current_user_claims), 
    db: Session = Depends(get_db),
    token: Optional[str] = None
) -> User:
    if token:
        claims = get_current_user_claims(token=token)
    elif not claims:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Geçersiz veya süresi dolmuş kimlik doğrulama token'ı."
        )

    user_id = claims.get("user_id")
    try:
        # UUID formatını güvenli bir şekilde doğrulayıp sorguluyoruz
        target_uuid = UUID(str(user_id))
        user = db.query(User).filter(User.id == target_uuid).first()
    except ValueError:
        # Eğer sub alanında e-posta kalmışsa geriye dönük uyumluluk sağlıyoruz
        user = db.query(User).filter(User.email == str(user_id)).first()
    
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Kullanıcı veritabanında bulunamadı."
        )
    return user

def verify_meeting_access(
    meeting_id: UUID,
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db)
) -> dict:
    """
    Toplantı odası verilerine (notlar, aksiyonlar, katılımcılar vb.) yetkisiz erişimi engelleyen bariyer dependency'si.
    Hem kayıtlı kullanıcı hem de misafir (guest) token'larını doğrular.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bu toplantıya erişmek için yetkilendirme token'ı zorunludur."
        )

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        from app.routes.guest import validate_guest_token
        payload = validate_guest_token(token)
        if not payload:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Geçersiz veya süresi dolmuş erişim token'ı."
            )
        payload["role"] = "guest"

    role = payload.get("role")
    sub = payload.get("sub") or payload.get("guest_id")

    from app.models.meeting import Meeting
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Toplantı bulunamadı.")

    if role == "guest":
        token_meeting_id = payload.get("meeting_id")
        token_meeting_code = payload.get("meeting_code")
        if token_meeting_id and str(token_meeting_id) != str(meeting_id):
            raise HTTPException(status_code=403, detail="Misafir token'ı bu toplantı ile eşleşmiyor.")
        if token_meeting_code and token_meeting_code != meeting.meeting_code:
            raise HTTPException(status_code=403, detail="Misafir token'ı bu toplantı ile eşleşmiyor.")
        return {"user_id": sub, "role": "guest", "guest_name": payload.get("guest_name", "Misafir"), "meeting_id": str(meeting_id)}

    # Kayıtlı kullanıcı yetki kontrolü
    try:
        user_uuid = UUID(str(sub))
        user = db.query(User).filter(User.id == user_uuid).first()
    except (ValueError, TypeError):
        user = db.query(User).filter(User.email == str(sub)).first()

    if not user:
        raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı.")

    if user.role == "admin" or meeting.created_by == user.id:
        return {"user_id": str(user.id), "role": "host" if meeting.created_by == user.id else "admin", "user": user, "meeting_id": str(meeting_id)}

    from app.models.meeting_participant import MeetingParticipant
    participant = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting_id,
        MeetingParticipant.user_id == user.id
    ).first()

    if not participant or participant.status in ["REJECTED", "declined"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu toplantının verilerine erişim izniniz bulunmuyor."
        )

    return {"user_id": str(user.id), "role": participant.role, "user": user, "meeting_id": str(meeting_id)}

def get_current_admin_user(
    current_user: User = Depends(get_current_user)
) -> User:
    if getattr(current_user, "role", None) != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu işlemi gerçekleştirmek için yönetici (admin) yetkiniz bulunmalıdır."
        )
    return current_user

API_KEY_NAME = "X-API-KEY"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

def validate_api_key(api_key: str = Depends(api_key_header), db: Session = Depends(get_db)):
    """İstek header'ındaki X-API-KEY verisini doğrular."""
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-API-KEY header eksik."
        )
    
    if api_key == "yebsoft_secret_integration_token_2026":
        return {"app_name": "Harici Entegrasyon Sistemi", "scope": "report_read"}
        
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Geçersiz veya aktif olmayan API Key."
    )