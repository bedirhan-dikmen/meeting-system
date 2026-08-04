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
        user_id_str = str(user_id)
        if user_id_str not in self.user_connections:
            self.user_connections[user_id_str] = set()
        self.user_connections[user_id_str].add(websocket)
        logger.info(f"[EventBus] Kullanıcı bağlandı: {user_id_str} (Aktif socket: {len(self.user_connections[user_id_str])})")

    def disconnect(self, user_id: str, websocket: WebSocket):
        """Kullanıcının WebSocket bağlantısını siler."""
        user_id_str = str(user_id)
        if user_id_str in self.user_connections:
            self.user_connections[user_id_str].discard(websocket)
            if not self.user_connections[user_id_str]:
                del self.user_connections[user_id_str]
        logger.info(f"[EventBus] Kullanıcı ayrıldı: {user_id_str}")

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
            targets = [str(uid) for uid in target_user_ids]
            for uid in targets:
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
