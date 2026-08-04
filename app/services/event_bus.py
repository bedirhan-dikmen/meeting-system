import json
import logging
from typing import Dict, Set, List, Optional, Any
from fastapi import WebSocket

logger = logging.getLogger("event_bus")

class SystemEventBus:
    """
    Sistem genelindeki canlı olayları (Toplantı Oluşturuldu, Güncellendi, Başlatıldı, Bitirildi, İptal Edildi vb.)
    oturum açmış kullanıcılara WebSocket üzerinden anlık yayınlayan Event Bus.
    """
    def __init__(self):
        # Yaptirim: { user_id_str: set(WebSocket) }
        self.user_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        """Kullanıcının WebSocket bağlantısını gruba ekler."""
        await websocket.accept()
        if user_id not in self.user_connections:
            self.user_connections[user_id] = set()
        self.user_connections[user_id].add(websocket)
        logger.info(f"[EventBus] Kullanıcı bağlandı: {user_id} (Aktif socket: {len(self.user_connections[user_id])})")

    def disconnect(self, user_id: str, websocket: WebSocket):
        """Kullanıcının WebSocket bağlantısını siler."""
        if user_id in self.user_connections:
            self.user_connections[user_id].discard(websocket)
            if not self.user_connections[user_id]:
                del self.user_connections[user_id]
        logger.info(f"[EventBus] Kullanıcı ayrıldı: {user_id}")

    async def broadcast_event(
        self,
        event_type: str,
        payload: Dict[str, Any],
        target_user_ids: Optional[List[str]] = None
    ):
        """
        Belirli kullanıcılara veya tüm aktif kullanıcılara canlı event yayınlar.
        target_user_ids: None ise tüm bağlı kullanıcılara yayınlar.
        """
        message_data = json.dumps({
            "event": event_type,
            "data": payload
        })

        if target_user_ids is not None:
            # Sadece hedef kullanıcılara gönder
            for uid in target_user_ids:
                sockets = self.user_connections.get(uid, set()).copy()
                for ws in sockets:
                    try:
                        await ws.send_text(message_data)
                    except Exception as e:
                        logger.warning(f"[EventBus] Mesaj gönderim hatası (User {uid}): {e}")
                        self.disconnect(uid, ws)
        else:
            # Tüm bağlı kullanıcılara yayınla (Global Broadcast)
            for uid, sockets in list(self.user_connections.items()):
                for ws in sockets.copy():
                    try:
                        await ws.send_text(message_data)
                    except Exception as e:
                        logger.warning(f"[EventBus] Mesaj gönderim hatası (User {uid}): {e}")
                        self.disconnect(uid, ws)

# Global Event Bus Örneği
event_bus = SystemEventBus()
