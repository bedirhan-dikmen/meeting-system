import json
import asyncio
from fastapi import WebSocket
from typing import Dict, List, Optional

class SignalingManager:
    def __init__(self):
        # Yapi: { meeting_code: { user_id_str: { "websocket": WebSocket, "info": dict } } }
        self.active_rooms: Dict[str, Dict[str, dict]] = {}
        # Yapi: { meeting_code: { "presenter_id": str, "presenter_name": str } }
        self.active_screen_shares: Dict[str, dict] = {}
        # Grace Period: F5 yenilemede kopma bildirimlerini geciktiren tasks: { "meeting_code:user_id": Task }
        self.pending_disconnects: Dict[str, asyncio.Task] = {}
        # Lobi Onayı Almış Kullanıcılar: { meeting_code: set(user_id_str) }
        self.approved_lobby_users: Dict[str, set] = {}
        # Bekleyen Lobi İstençleri: { meeting_code: { user_id_str: user_info } }
        self.pending_lobby_requests: Dict[str, Dict[str, dict]] = {}

    def is_user_approved(self, meeting_code: str, user_id: str) -> bool:
        return user_id in self.approved_lobby_users.get(meeting_code, set())

    async def add_pending_lobby_request(self, meeting_code: str, user_id: str, user_info: dict):
        if meeting_code not in self.pending_lobby_requests:
            self.pending_lobby_requests[meeting_code] = {}
        self.pending_lobby_requests[meeting_code][user_id] = user_info

        await self.broadcast_to_room(
            meeting_code=meeting_code,
            message={
                "type": "lobby-join-request",
                "sender_id": user_id,
                "user_info": user_info
            },
            exclude_user=user_id
        )

    async def approve_lobby_user(self, meeting_code: str, target_id: str):
        if meeting_code not in self.approved_lobby_users:
            self.approved_lobby_users[meeting_code] = set()
        self.approved_lobby_users[meeting_code].add(target_id)

        if meeting_code in self.pending_lobby_requests:
            self.pending_lobby_requests[meeting_code].pop(target_id, None)

        await self.send_targeted_message(meeting_code, target_id, {
            "type": "lobby-approved",
            "meeting_code": meeting_code,
            "message": "Katılım talebiniz toplantı yöneticisi tarafından onaylandı."
        })

    async def reject_lobby_user(self, meeting_code: str, target_id: str):
        if meeting_code in self.approved_lobby_users:
            self.approved_lobby_users[meeting_code].discard(target_id)
        if meeting_code in self.pending_lobby_requests:
            self.pending_lobby_requests[meeting_code].pop(target_id, None)

        await self.send_targeted_message(meeting_code, target_id, {
            "type": "lobby-rejected",
            "meeting_code": meeting_code,
            "message": "Katılım talebiniz toplantı yöneticisi tarafından reddedildi."
        })
        await self.kick_user(meeting_code, target_id, reason="Rejected")

    async def connect(self, meeting_code: str, user_id: str, websocket: WebSocket, user_info: Optional[dict] = None):
        """Kullaniciyi ilgili toplanti odasina baglar ve F5 yenilemelerini Grace Period ile sessizce yonetir."""
        await websocket.accept()
        
        disc_key = f"{meeting_code}:{user_id}"
        is_reconnect = False

        # Eger F5 yenileme esnasinda askida bekleyen bir disconnect varsa iptal et
        if disc_key in self.pending_disconnects:
            task = self.pending_disconnects.pop(disc_key)
            task.cancel()
            is_reconnect = True

        if meeting_code not in self.active_rooms:
            self.active_rooms[meeting_code] = {}

        if user_id in self.active_rooms[meeting_code]:
            is_reconnect = True

        # Odadaki mevcut tum katilimcilarin detayli verisini topla
        existing_participants = []
        for uid, data in self.active_rooms[meeting_code].items():
            if isinstance(data, dict) and data.get("info"):
                if not data["info"].get("in_lobby"):
                    existing_participants.append(data["info"])

        participant_data = user_info or {
            "id": user_id,
            "name": f"Kullanici ({user_id[:5]})",
            "role": "user"
        }

        self.active_rooms[meeting_code][user_id] = {
            "websocket": websocket,
            "info": participant_data
        }

        # Ekran paylaşımı yapan sunucu yeniden bağlanırsa (F5) veya koptuysa ekran paylaşımını kesin olarak sonlandır
        if meeting_code in self.active_screen_shares and self.active_screen_shares[meeting_code].get("presenter_id") == user_id:
            self.active_screen_shares.pop(meeting_code, None)
            await self.broadcast_to_room(
                meeting_code=meeting_code,
                message={"type": "screen-share-stop"}
            )

        pending_requests = list(self.pending_lobby_requests.get(meeting_code, {}).values())

        # İstemciye odanın durumunu ilet
        await websocket.send_text(json.dumps({
            "type": "room-state",
            "users": existing_participants,
            "pending_lobby_requests": pending_requests,
            "active_screen_share": self.active_screen_shares.get(meeting_code)
        }))
        
        # Sadece LOBİDE DEĞİLSE ve GERÇEK yeni katılım ise diger üyelere "user-joined" fırlat (F5 yenilemesinde fırlatma)
        if not is_reconnect and not participant_data.get("in_lobby"):
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
        if not isinstance(info_update, dict):
            return
        if meeting_code in self.active_rooms and user_id in self.active_rooms[meeting_code]:
            if "info" in self.active_rooms[meeting_code][user_id]:
                clean_update = {k: v for k, v in info_update.items() if k not in ("type", "sender_id", "target_id")}
                if "user_info" in clean_update and isinstance(clean_update["user_info"], dict):
                    nested = clean_update.pop("user_info")
                    clean_update.update(nested)
                self.active_rooms[meeting_code][user_id]["info"].update(clean_update)

    async def disconnect(self, meeting_code: str, user_id: str, grace_period_seconds: float = 4.0):
        """
        Kullanıcının bağlantısı koptuğunda Grace Period (4s) başlatır.
        Eğer ekran paylaşan sunucu ise ekran paylaşımı anında sonlandırılır.
        """
        # Ekran paylaşımı yapan kişi koptuysa/yenilediyse ekran paylaşımını anında temizle
        if meeting_code in self.active_screen_shares and str(self.active_screen_shares[meeting_code].get("presenter_id")) == user_id:
            self.active_screen_shares.pop(meeting_code, None)
            await self.broadcast_to_room(
                meeting_code=meeting_code,
                message={"type": "screen-share-stop"}
            )

        disc_key = f"{meeting_code}:{user_id}"
        if disc_key in self.pending_disconnects:
            self.pending_disconnects[disc_key].cancel()

        async def _delayed_disconnect():
            try:
                await asyncio.sleep(grace_period_seconds)
            except asyncio.CancelledError:
                return  # Yeniden bağlandı, ayrılma bildirimini iptal et

            self.pending_disconnects.pop(disc_key, None)
            await self._finalize_disconnect(meeting_code, user_id)

        self.pending_disconnects[disc_key] = asyncio.create_task(_delayed_disconnect())

    async def _finalize_disconnect(self, meeting_code: str, user_id: str):
        """Gerçekleşen kopmayı kesinleştirir ve odadakilere duyurur."""
        try:
            if meeting_code in self.active_rooms:
                self.active_rooms[meeting_code].pop(user_id, None)
                
                if meeting_code in self.active_screen_shares and self.active_screen_shares[meeting_code].get("presenter_id") == user_id:
                    self.active_screen_shares.pop(meeting_code, None)
        finally:
            if meeting_code in self.active_rooms:
                if not self.active_rooms[meeting_code]:
                    self.active_rooms.pop(meeting_code, None)
                    self.active_screen_shares.pop(meeting_code, None)
                else:
                    await self.broadcast_to_room(
                        meeting_code=meeting_code,
                        message={
                            "type": "user-left",
                            "sender_id": user_id,
                            "message": "Kullanıcı odadan ayrıldı."
                        }
                    )

    async def kick_user(self, meeting_code: str, target_id: str, reason: str = "Kicked"):
        """Toplantıdan çıkarılan veya reddedilen kullanıcının soketini zorla kapatır."""
        disc_key = f"{meeting_code}:{target_id}"
        if disc_key in self.pending_disconnects:
            self.pending_disconnects.pop(disc_key).cancel()

        if meeting_code in self.active_rooms and target_id in self.active_rooms[meeting_code]:
            user_data = self.active_rooms[meeting_code].pop(target_id, None)
            if isinstance(user_data, dict):
                ws: Optional[WebSocket] = user_data.get("websocket")
                if ws:
                    try:
                        msg_type = "guest-rejected" if reason == "Rejected" else "kicked"
                        await ws.send_text(json.dumps({
                            "type": msg_type,
                            "message": "Toplantı katılım talebiniz reddedildi." if reason == "Rejected" else "Toplantıdan çıkarıldınız."
                        }))
                        await ws.close(code=4003, reason=reason)
                    except Exception:
                        pass
        await self._finalize_disconnect(meeting_code, target_id)

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        """Sadece belirli bir bağlantıya doğrudan mesaj gönderir."""
        await websocket.send_text(json.dumps(message))

    async def send_targeted_message(self, meeting_code: str, recipient_id: str, message: dict):
        """Odadaki belirli bir katılımcıya mesaj gönderir. Soket kapalıysa derhal temizler."""
        if meeting_code in self.active_rooms:
            user_data = self.active_rooms[meeting_code].get(recipient_id)
            if isinstance(user_data, dict):
                ws = user_data.get("websocket")
                if ws:
                    try:
                        await ws.send_text(json.dumps(message))
                    except Exception:
                        self.active_rooms[meeting_code].pop(recipient_id, None)

    async def broadcast_to_room(self, meeting_code: str, message: dict, exclude_user: Optional[str] = None):
        """Odadaki herkese mesaj yayınlar. Ölü bağlantıları anında temizler."""
        if meeting_code not in self.active_rooms:
            return
        dead_users = []
        message_text = json.dumps(message)
        for user_id, user_data in list(self.active_rooms[meeting_code].items()):
            if exclude_user and user_id == exclude_user:
                continue
            if isinstance(user_data, dict):
                ws = user_data.get("websocket")
                if ws:
                    try:
                        await ws.send_text(message_text)
                    except Exception:
                        dead_users.append(user_id)
        # Ölü bağlantıları temizle
        for dead_id in dead_users:
            self.active_rooms[meeting_code].pop(dead_id, None)

    def get_active_participants(self, meeting_code: str) -> List[dict]:
        """Anlık olarak oda içinde (WebSocket) aktif bağlı bulunan kullanıcıların listesini döner."""
        if meeting_code not in self.active_rooms:
            return []
        
        active_list = []
        for uid, user_payload in list(self.active_rooms[meeting_code].items()):
            if isinstance(user_payload, dict):
                info = user_payload.get("info", {})
                name = info.get("name", "Kullanıcı")
                parts = name.strip().split()
                initials = "".join([p[0] for p in parts[:2]]).upper() if parts else "K"
                active_list.append({
                    "id": uid,
                    "name": name,
                    "initials": initials,
                    "avatar": info.get("avatar_url")
                })
        return active_list

# Tekil (Singleton) bir manager nesnesi oluşturuyoruz
signaling_manager = SignalingManager()