import json
from fastapi import WebSocket
from typing import Dict, List

class SignalingManager:
    def __init__(self):
        # Yapı: { meeting_code: { user_id_str: WebSocket } }
        self.active_rooms: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, meeting_code: str, user_id: str, websocket: WebSocket):
        """Kullanıcıyı ilgili toplantı odasına bağlar."""
        await websocket.accept()
        
        if meeting_code not in self.active_rooms:
            self.active_rooms[meeting_code] = {}
            
        self.active_rooms[meeting_code][user_id] = websocket
        
        # Odadaki diğer kullanıcılara yeni bir katılımcının geldiğini bildir
        await self.broadcast_to_room(
            meeting_code=meeting_code,
            message={
                "type": "user-joined",
                "sender_id": user_id,
                "message": f"Kullanıcı {user_id} odaya katıldı."
            },
            exclude_user=user_id
        )

    async def disconnect(self, meeting_code: str, user_id: str):
        """Kullanıcının bağlantısını koparır ve odadan temizler."""
        if meeting_code in self.active_rooms:
            if user_id in self.active_rooms[meeting_code]:
                del self.active_rooms[meeting_code][user_id]
                
            # Eğer odada hiç kimse kalmadıysa odayı tamamen sil
            if not self.active_rooms[meeting_code]:
                del self.active_rooms[meeting_code]
            else:
                # Kalan kullanıcılara ayrılma bilgisini bildir
                await self.broadcast_to_room(
                    meeting_code=meeting_code,
                    message={
                        "type": "user-left",
                        "sender_id": user_id,
                        "message": f"Kullanıcı {user_id} odadan ayrıldı."
                    }
                )

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        """Sadece belirli bir bağlantıya doğrudan mesaj gönderir."""
        await websocket.send_text(json.dumps(message))

    async def send_targeted_message(self, meeting_code: str, recipient_id: str, message: dict):
        """Odadaki belirli bir katılımcıya (Targeted/Unicast) mesaj gönderir (WebRTC el sıkışması için kritik)."""
        if meeting_code in self.active_rooms:
            recipient_ws = self.active_rooms[meeting_code].get(recipient_id)
            if recipient_ws:
                await recipient_ws.send_text(json.dumps(message))

    async def broadcast_to_room(self, meeting_code: str, message: dict, exclude_user: str = None):
        """Odadaki herkese mesaj yayınlar (Broadcast)."""
        if meeting_code in self.active_rooms:
            for user_id, websocket in self.active_rooms[meeting_code].items():
                if exclude_user and user_id == exclude_user:
                    continue
                try:
                    await websocket.send_text(json.dumps(message))
                except Exception:
                    # Bağlantısı kopmuş ama henüz temizlenmemiş soketleri es geç
                    pass

# Tekil (Singleton) bir manager nesnesi oluşturuyoruz
signaling_manager = SignalingManager()