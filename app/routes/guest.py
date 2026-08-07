# app/routes/guest.py
"""
Misafir (kayıtsız kullanıcı) API'si.
- Oda bilgilerini herkese açık döner
- Şifre kontrolü yaparak imzalı guest_token üretir
- guest_token doğrulama
"""
import hmac
import hashlib
import json
import time
import base64
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional
from app.core.database import SessionLocal
from app.models.meeting import Meeting
from app.core.config import settings
from app.services.meetings import is_meeting_finished

router = APIRouter(prefix="/guest", tags=["Misafir Erişimi"])


# ── Yardımcı: HMAC-SHA256 imzalı token ──────────────────────────────────────

def _create_guest_token(meeting_code: str, guest_id: str, guest_name: str, ttl_seconds: int = 14400) -> str:
    """4 saat geçerli, HMAC-imzalı misafir token'ı üretir."""
    payload = {
        "meeting_code": meeting_code,
        "guest_id": guest_id,
        "guest_name": guest_name,
        "exp": int(time.time()) + ttl_seconds,
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.new(settings.SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


from jose import jwt, JWTError
from app.core.security import create_guest_token as create_jwt_guest_token

def validate_guest_token(token: str) -> Optional[dict]:
    """Token'i doğrular (JWT veya HMAC). Geçerliyse payload dict döner, değilse None."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("role") == "guest" or "guest_id" in payload or "guest_name" in payload:
            if "guest_id" not in payload and "sub" in payload:
                payload["guest_id"] = payload["sub"]
            return payload
    except JWTError:
        pass

    try:
        payload_b64, sig = token.rsplit(".", 1)
        expected_sig = hmac.new(settings.SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "=="))
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


# ── Şemalar ─────────────────────────────────────────────────────────────────

class GuestTokenRequest(BaseModel):
    meeting_code: str = Field(..., description="Oda kodu (yeb-xxxx-xxxx)")
    guest_name: str   = Field(..., min_length=2, max_length=60, description="Misafirin adı soyadı")
    passcode: Optional[str] = Field(None, description="Oda şifresi (zorunluysa)")


class GuestTokenResponse(BaseModel):
    guest_token: str
    guest_id: str
    guest_name: str
    meeting_title: str
    meeting_code: str
    lobby_enabled: bool


class MeetingPublicInfo(BaseModel):
    title: str
    meeting_code: str
    meeting_type: str
    passcode_required: bool
    lobby_enabled: bool
    status: str


# ── Endpoint'ler ─────────────────────────────────────────────────────────────

@router.get("/meeting/{meeting_code}", response_model=MeetingPublicInfo)
def get_public_meeting_info(meeting_code: str):
    """Odanın herkese açık bilgilerini döner."""
    db = SessionLocal()
    try:
        meeting = db.query(Meeting).filter(Meeting.meeting_code == meeting_code, Meeting.is_active == True).first()
        if not meeting:
            raise HTTPException(status_code=404, detail="Toplantı bulunamadı veya artık aktif değil.")
        # BUG FIX: Sadece "tamamlandı" 410 sayılıyordu, "iptal edildi" durumu
        # bu kontrolden kaçıyordu — is_meeting_finished ile tüm bitmiş/iptal
        # durumları tutarlı şekilde kapsanıyor (bkz. services/meetings.py).
        if is_meeting_finished(meeting):
            raise HTTPException(status_code=410, detail="Bu toplantı sona erdi.")
        return MeetingPublicInfo(
            title=meeting.title,
            meeting_code=meeting.meeting_code,
            meeting_type=meeting.meeting_type or "Genel Toplantı",
            passcode_required=bool(meeting.passcode),
            lobby_enabled=meeting.lobby_enabled,
            status=meeting.status,
        )
    finally:
        db.close()


@router.post("/token", response_model=GuestTokenResponse, status_code=status.HTTP_201_CREATED)
@router.post("/join", response_model=GuestTokenResponse, status_code=status.HTTP_201_CREATED)
def create_guest_token(payload: GuestTokenRequest):
    """
    Misafirin adını ve oda şifresini doğrular.
    Başarılıysa imzalı guest_token döner.
    """
    import uuid as _uuid
    db = SessionLocal()
    try:
        meeting = db.query(Meeting).filter(
            Meeting.meeting_code == payload.meeting_code,
            Meeting.is_active == True
        ).first()

        if not meeting:
            raise HTTPException(status_code=404, detail="Toplantı bulunamadı.")
        if is_meeting_finished(meeting):
            raise HTTPException(status_code=410, detail="Bu toplantı sona erdi.")

        # Şifre kontrolü
        if meeting.passcode:
            if not payload.passcode or payload.passcode.strip() != meeting.passcode.strip():
                raise HTTPException(status_code=401, detail="Oda şifresi yanlış. Lütfen tekrar deneyin.")

        # Geçici misafir ID üret
        guest_id = f"guest_{_uuid.uuid4().hex[:12]}"
        guest_name_str = payload.guest_name.strip()

        token = create_jwt_guest_token(
            meeting_id=meeting.id,
            guest_name=guest_name_str,
            guest_id=guest_id,
            duration_minutes=240,
            meeting_code=meeting.meeting_code
        )

        return GuestTokenResponse(
            guest_token=token,
            guest_id=guest_id,
            guest_name=guest_name_str,
            meeting_title=meeting.title,
            meeting_code=meeting.meeting_code,
            lobby_enabled=meeting.lobby_enabled,
        )
    finally:
        db.close()


@router.get("/validate")
def validate_token_endpoint(token: str):
    """guest_token doğrular."""
    payload = validate_guest_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Geçersiz veya süresi dolmuş misafir token'ı.")
    return {
        "valid": True,
        "guest_id": payload.get("guest_id") or payload.get("sub"),
        "guest_name": payload.get("guest_name", "Misafir"),
        "meeting_code": payload.get("meeting_code")
    }
