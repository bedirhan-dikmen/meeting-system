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


def validate_guest_token(token: str) -> Optional[dict]:
    """Token'i doğrular. Geçerliyse payload dict döner, değilse None."""
    try:
        payload_b64, sig = token.rsplit(".", 1)
        expected_sig = hmac.new(settings.SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "=="))
        if payload.get("exp", 0) < int(time.time()):
            return None  # Süresi dolmuş
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
        if meeting.status == "tamamlandı":
            raise HTTPException(status_code=410, detail="Bu toplantı sona erdi.")
        return MeetingPublicInfo(
            title=str(meeting.title),
            meeting_code=str(meeting.meeting_code),
            meeting_type=str(meeting.meeting_type or "Genel Toplantı"),
            passcode_required=bool(meeting.passcode),
            lobby_enabled=bool(meeting.lobby_enabled),
            status=str(meeting.status),
        )
    finally:
        db.close()


@router.post("/token", response_model=GuestTokenResponse, status_code=status.HTTP_201_CREATED)
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
        if meeting.status == "tamamlandı":
            raise HTTPException(status_code=410, detail="Bu toplantı sona erdi.")

        # Şifre kontrolü
        if meeting.passcode:
            if not payload.passcode or payload.passcode.strip() != meeting.passcode.strip():
                raise HTTPException(status_code=401, detail="Oda şifresi yanlış. Lütfen tekrar deneyin.")

        # Geçici misafir ID üret
        guest_id = f"guest_{_uuid.uuid4().hex[:12]}"

        token = _create_guest_token(
            meeting_code=str(meeting.meeting_code),
            guest_id=guest_id,
            guest_name=payload.guest_name.strip(),
        )

        return GuestTokenResponse(
            guest_token=token,
            guest_id=guest_id,
            meeting_title=str(meeting.title),
            meeting_code=str(meeting.meeting_code),
            lobby_enabled=bool(meeting.lobby_enabled),
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
        "guest_id": payload["guest_id"],
        "guest_name": payload["guest_name"],
        "meeting_code": payload["meeting_code"]
    }
