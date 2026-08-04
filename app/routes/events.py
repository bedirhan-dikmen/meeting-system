import logging
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from jose import jwt, JWTError

from app.core.config import settings
from app.services.event_bus import event_bus

logger = logging.getLogger("events_route")

router = APIRouter(tags=["Real-time System Events"])

@router.websocket("/ws/events")
async def websocket_events_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(None, description="Kullanıcı JWT token'ı")
):
    """
    Sistem genelindeki canlı olayları (toplantı oluşturma, başlama, güncellenme vb.)
    dinlemek için oturum açmış istemcilerin bağlandığı bildirim kanalı.
    """
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_id: Optional[str] = None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = payload.get("sub")
    except JWTError:
        logger.warning("[EventsWS] Geri çevrilen bağlantı: Geçersiz token.")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    if not user_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await event_bus.connect(user_id, websocket)
    try:
        while True:
            # İstemciden gelen ping/heartbeat mesajlarını dinle ve canlı tut
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        event_bus.disconnect(user_id, websocket)
    except Exception as e:
        logger.warning(f"[EventsWS] Bağlantı sonlandı ({user_id}): {e}")
        event_bus.disconnect(user_id, websocket)
