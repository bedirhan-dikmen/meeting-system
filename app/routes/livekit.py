from fastapi import APIRouter, Depends, HTTPException
from livekit import api
from app.core.security import get_current_user
from app.models.user import User

router = APIRouter(prefix="/livekit", tags=["LiveKit Entegrasyonu"])

LIVEKIT_API_KEY = "devkey"
LIVEKIT_API_SECRET = "secret_key_yebsoft_2026_livekit_access_token"

@router.get("/token/{room_code}")
def get_livekit_token(
    room_code: str,
    current_user: User = Depends(get_current_user)
):
    """
    Oda koduna göre kullanıcıya özel LiveKit erişim token'ı üretir.
    """
    user_identity = str(current_user.id)
    user_name = f"{current_user.first_name or ''} {current_user.last_name or ''}".trim() or current_user.email

    token = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET) \
        .with_identity(user_identity) \
        .with_name(user_name) \
        .with_grants(api.VideoGrants(
            room_join=True,
            room=room_code,
            can_publish=True,
            can_subscribe=True
        ))

    return {
        "server_url": "ws://localhost:7880",
        "token": token.to_jwt()
    }