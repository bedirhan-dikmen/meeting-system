import json
from fastapi import WebSocket
from typing import Dict, List

class SignalingManager:
    def __init__(self):
        # Yapi: { meeting_code: { user_id_str: { "websocket": WebSocket, "info": dict } } }
        self.active_rooms: Dict[str, Dict[str, dict]] = {}
        # Yapi: { meeting_code: { "presenter_id": str, "presenter_name": str } }
        self.active_screen_shares: Dict[str, dict] = {}

    async def connect(self, meeting_code: str, user_id: str, websocket: WebSocket, user_info: dict | None = None):
        """Kullaniciyi ilgili toplanti odasina baglar ve odadaki tum aktif katilimci durumunu (room-state) iletir."""
        await websocket.accept()
        
        if meeting_code not in self.active_rooms:
            self.active_rooms[meeting_code] = {}

        # Odadaki mevcut tum katilimcilarin detayli verisini topla
        existing_participants = []
        for uid, data in self.active_rooms[meeting_code].items():
            if isinstance(data, dict) and data.get("info"):
                existing_participants.append(data["info"])

        # Yeni baglantiyi ve katilimci bilgisini kaydet
        participant_data = user_info or {
            "id": user_id,
            "name": f"Kullanici ({user_id[:5]})",
            "role": "user"
        }

        self.active_rooms[meeting_code][user_id] = {
            "websocket": websocket,
            "info": participant_data
        }

        # Yeni baglanan istemciye odadaki tum mevcut katilimcilarin ve aktif ekran paylasiminin bilgisini ulastir
        await websocket.send_text(json.dumps({
            "type": "room-state",
            "users": existing_participants,
            "active_screen_share": self.active_screen_shares.get(meeting_code)
        }))
        
        # Odadaki diğer katılımcılara yeni bir üyenin geldiğini bildir
        await self.broadcast_to_room(
            meeting_code=meeting_code,
            message={
                "type": "user-joined",
                "sender_id": user_id,
                "user_info": participant_data,
                "message": f"{participant_data.get('name', 'Katılımcı')} odaya katıldı."
            },
            exclude_user=user_id
        )

    async def update_user_info(self, meeting_code: str, user_id: str, info_update: dict):
        """Kullanıcının kamera/mikrofon durum güncellemelerini odadaki veride saklar."""
        if meeting_code in self.active_rooms and user_id in self.active_rooms[meeting_code]:
            if "info" in self.active_rooms[meeting_code][user_id]:
                self.active_rooms[meeting_code][user_id]["info"].update(info_update)

    async def disconnect(self, meeting_code: str, user_id: str):
        """Kullanicinin baglantisini koparir ve odadan temizler."""
        if meeting_code in self.active_rooms:
            if user_id in self.active_rooms[meeting_code]:
                del self.active_rooms[meeting_code][user_id]
                
            # Eger ayrilan kisi ekran paylasimi yapan kisi ise kaydi temizle
            if meeting_code in self.active_screen_shares and self.active_screen_shares[meeting_code].get("presenter_id") == user_id:
                del self.active_screen_shares[meeting_code]

            # Odada kimse kalmadiysa odayi sil
            if not self.active_rooms[meeting_code]:
                del self.active_rooms[meeting_code]
                if meeting_code in self.active_screen_shares:
                    del self.active_screen_shares[meeting_code]
            else:
                # Kalan kullanicilara ayrilma bilgisini duyur
                await self.broadcast_to_room(
                    meeting_code=meeting_code,
                    message={
                        "type": "user-left",
                        "sender_id": user_id,
                        "message": f"Kullanici odadan ayrildi."
                    }
                )

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        """Sadece belirli bir bağlantıya doğrudan mesaj gönderir."""
        await websocket.send_text(json.dumps(message))

    async def send_targeted_message(self, meeting_code: str, recipient_id: str, message: dict):
        """Odadaki belirli bir katılımcıya (Targeted/Unicast) mesaj gönderir."""
        if meeting_code in self.active_rooms:
            user_data = self.active_rooms[meeting_code].get(recipient_id)
            if isinstance(user_data, dict):
                ws = user_data.get("websocket")
                if ws:
                    try:
                        await ws.send_text(json.dumps(message))
                    except Exception:
                        pass

    async def broadcast_to_room(self, meeting_code: str, message: dict, exclude_user: str | None = None):
        """Odadaki herkese mesaj yayınlar (Broadcast)."""
        if meeting_code in self.active_rooms:
            for user_id, user_data in list(self.active_rooms[meeting_code].items()):
                if exclude_user and user_id == exclude_user:
                    continue
                if isinstance(user_data, dict):
                    ws = user_data.get("websocket")
                    if ws:
                        try:
                            await ws.send_text(json.dumps(message))
                        except Exception:
                            pass

# Tekil (Singleton) bir manager nesnesi oluşturuyoruz
signaling_manager = SignalingManager()