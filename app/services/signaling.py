import json
import asyncio
from fastapi import WebSocket
from typing import Any, Dict, List, Optional

class SignalingManager:
    def __init__(self):
        # Yapi: { meeting_code: { user_id_str: { "websocket": WebSocket, "info": dict } } }
        self.active_rooms: Dict[str, Dict[str, dict]] = {}
        # Yapi: { meeting_code: { "presenter_id": str, "presenter_name": str } }
        self.active_screen_shares: Dict[str, dict] = {}
        # Grace Period: F5 yenilemede kopma bildirimlerini geciktiren tasks: { "meeting_code:user_id": Task }
        self.pending_disconnects: Dict[str, asyncio.Task] = {}
        # Ekran Paylaşımı Grace Period: Sunucu paylaşımı yapan kişinin bağlantısı
        # koptuğunda (ör. F5) "screen-share-stop"u ANINDA yayınlamak yerine bu
        # süre kadar bekler — kişi (aynı grace-period içinde) geri bağlanırsa
        # paylaşım diğer katılımcıların ekranında hiç kesilmeden "aktif" kalır.
        # { meeting_code: Task }
        self.pending_screen_share_stops: Dict[str, asyncio.Task] = {}
        self.SCREEN_SHARE_GRACE_SECONDS = 8.0
        # Lobi Onayı Almış Kullanıcılar: { meeting_code: set(user_id_str) }
        self.approved_lobby_users: Dict[str, set] = {}
        # Bekleyen Lobi İstençleri: { meeting_code: { user_id_str: user_info } }
        self.pending_lobby_requests: Dict[str, Dict[str, dict]] = {}
        # TEK YETKİLİ "EDİTÖR": { meeting_code: user_id_str }. Odada aynı anda
        # sadece BİR editör vardır — lobi onay talepleri SADECE bu kişiye gider
        # (bkz. _recompute_editor). Diğer tüm ayrıcalıklı (admin/manager)
        # katılımcılar toplantının her fonksiyonuna erişebilir, sadece giriş
        # onay kuyruğunu görmezler (ekran kalabalığı / çelişen onay-red önlenir).
        self.room_editors: Dict[str, str] = {}

    def is_user_approved(self, meeting_code: str, user_id: str) -> bool:
        return user_id in self.approved_lobby_users.get(meeting_code, set())

    def is_privileged(self, meeting_code: str, user_id: str) -> bool:
        """Bir kullanıcının o odada şu an ayrıcalıklı (toplantı sahibi/editör
        veya admin-manager rolü) olup olmadığını döner. Kick, zorla mikrofon/
        kamera kapatma gibi yönetimsel komutlar bu kontrolden geçmeden ASLA
        uygulanmamalı — istemci tarafı kontrolü tek başına güvenilir değildir."""
        room = self.active_rooms.get(meeting_code, {})
        data = room.get(user_id)
        if not isinstance(data, dict):
            return False
        info = data.get("info") or {}
        return bool(info.get("is_privileged") or info.get("is_host"))

    def _get_privileged_user_ids(self, meeting_code: str) -> List[str]:
        """Odada şu an bağlı olan 'editör' (toplantı sahibi) veya 'yönetici'
        (admin/manager rolü) katılımcıların user_id listesini döner."""
        room = self.active_rooms.get(meeting_code, {})
        privileged = []
        for uid, data in room.items():
            if not isinstance(data, dict):
                continue
            info = data.get("info") or {}
            if info.get("is_privileged") or info.get("is_host"):
                privileged.append(uid)
        return privileged

    def get_editor(self, meeting_code: str) -> Optional[str]:
        return self.room_editors.get(meeting_code)

    def _recompute_editor(self, meeting_code: str) -> Optional[str]:
        """Odanın güncel TEK 'editör'ünü belirler/günceller ve döner.
        Öncelik sırası:
          1) Toplantıyı OLUŞTURAN kişi (host) o an odadaysa her zaman editördür
             — geri döndüğünde ünvanı otomatik geri alır.
          2) Mevcut atanmış editör hâlâ odada ve ayrıcalıklıysa (admin/manager)
             değişmez — gereksiz devirler önlenir (kararlılık).
          3) Aksi halde odaya (bağlantı/katılım sırasına göre — dict ekleme
             sırası korunur) İLK giren ayrıcalıklı kullanıcıya devredilir.
          4) Odada ne host ne de ayrıcalıklı biri varsa editör koltuğu boş
             kalır; bir sonraki uygun katılımda yeniden atanır."""
        room = self.active_rooms.get(meeting_code, {})

        def _present(uid: str) -> bool:
            data = room.get(uid)
            info = (data or {}).get("info") or {}
            return isinstance(data, dict) and not info.get("in_lobby")

        def _privileged(uid: str) -> bool:
            data = room.get(uid)
            info = (data or {}).get("info") or {}
            return bool(info.get("is_privileged"))

        def _is_creator(uid: str) -> bool:
            data = room.get(uid)
            info = (data or {}).get("info") or {}
            return bool(info.get("is_host"))

        for uid in room:
            if _present(uid) and _is_creator(uid):
                self.room_editors[meeting_code] = uid
                return uid

        current = self.room_editors.get(meeting_code)
        if current and _present(current) and _privileged(current):
            return current

        for uid in room:
            if _present(uid) and _privileged(uid):
                self.room_editors[meeting_code] = uid
                return uid

        self.room_editors.pop(meeting_code, None)
        return None

    async def _handle_editor_change(
        self,
        meeting_code: str,
        old_editor: Optional[str],
        new_editor: Optional[str],
        already_notified_user: Optional[str] = None,
    ):
        """Editör değiştiğinde odaya duyurur ve yeni editöre (varsa) bekleyen
        tüm lobi taleplerini iletir — eski editör ayrılırken kuyrukta talep
        varsa kaybolmasın diye. `already_notified_user`, connect() akışında
        yeni editörün KENDİSİ o an bağlanan kullanıcıysa çift bildirim/liste
        göndermemek için kullanılır (o zaten room-state ile almıştır)."""
        if old_editor == new_editor:
            return
        if new_editor and new_editor != already_notified_user:
            pending = list(self.pending_lobby_requests.get(meeting_code, {}).values())
            await self.send_targeted_message(meeting_code, new_editor, {
                "type": "editor-assigned",
                "editor_id": new_editor,
                "pending_lobby_requests": pending
            })
        await self.broadcast_to_room(
            meeting_code=meeting_code,
            message={"type": "editor-changed", "editor_id": new_editor},
            exclude_user=new_editor
        )

    async def broadcast_to_privileged(self, meeting_code: str, message: dict, exclude_user: Optional[str] = None):
        """Bir mesajı SADECE odadaki editör/yönetici katılımcılara gönderir.
        Ekran paylaşım izni gibi, TÜM ayrıcalıklı kullanıcıların (sadece tek
        editörün değil) haberdar olması gereken yönetimsel bildirimler için
        kullanılır — lobi giriş talepleri için değil (bkz. add_pending_lobby_request)."""
        recipients = [uid for uid in self._get_privileged_user_ids(meeting_code) if uid != exclude_user]
        for uid in recipients:
            await self.send_targeted_message(meeting_code, uid, message)

    async def add_pending_lobby_request(self, meeting_code: str, user_id: str, user_info: dict):
        if meeting_code not in self.pending_lobby_requests:
            self.pending_lobby_requests[meeting_code] = {}
        self.pending_lobby_requests[meeting_code][user_id] = user_info

        # BUG FIX: Bu talep önce odadaki TÜM ayrıcalıklı (admin/manager) katılımcılara
        # gidiyordu — birden fazla yönetici varsa herkesin ekranında aynı istek
        # beliriyor, biri "kabul et" derken diğeri "reddet" diyebiliyordu (çakışma +
        # ekran kalabalığı). Artık SADECE odanın o anki tek "editörüne" (bkz.
        # _recompute_editor) hedefli olarak gönderiliyor. Diğer yöneticiler
        # toplantının tüm diğer fonksiyonlarına erişmeye devam eder, sadece giriş
        # onay kuyruğunu görmezler.
        editor_id = self.get_editor(meeting_code)
        if editor_id and editor_id != user_id:
            await self.send_targeted_message(meeting_code, editor_id, {
                "type": "lobby-join-request",
                "sender_id": user_id,
                "user_info": user_info
            })

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

        old_entry = self.active_rooms[meeting_code].get(user_id)
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

        # KRİTİK BUG FIX (yeni katılımcı kartı F5 olmadan görünmüyordu): Lobi
        # akışında (prejoin.js/guest.html) kullanıcı ÖNCE in_lobby=true ile ayrı
        # bir soket açıyor, onaylanınca o soketi kapatıp /room/{code}'a GERÇEK
        # in_lobby=false soketiyle yeniden bağlanıyor. Bu ikinci bağlantı, aynı
        # user_id hâlâ active_rooms'ta (eski lobi kaydı grace-period içinde
        # henüz temizlenmediği için) bulunduğundan yukarıdaki genel kontrolce
        # YANLIŞLIKLA "F5 yeniden bağlanması" sayılıyor ve bu yüzden aşağıdaki
        # 'user-joined' yayını sessizce atlanıyordu — odadaki HERKES yeni
        # katılımcıyı ancak kendi sayfalarını F5'leyip taze bir room-state
        # çekince görebiliyordu. Eski kayıt LOBİDEYken yeni bağlantı GERÇEK
        # odaya giriyorsa bu bir yeniden bağlanma DEĞİL, kullanıcının odaya
        # İLK GERÇEK GİRİŞİdir — is_reconnect'i burada kesin olarak geçersiz kılıyoruz.
        if isinstance(old_entry, dict):
            old_info = old_entry.get("info") or {}
            if old_info.get("in_lobby") and not participant_data.get("in_lobby"):
                is_reconnect = False

        self.active_rooms[meeting_code][user_id] = {
            "websocket": websocket,
            "info": participant_data
        }

        # Ekran paylaşımı yapan sunucu yeniden bağlandıysa (F5), askıda bekleyen
        # paylaşım sonlandırma görevini iptal et. active_screen_shares KASITLI
        # OLARAK silinMEZ — böylece diğer katılımcılara "screen-share-stop" hiç
        # gitmez, oda hâlâ bu kişiyi sunucu olarak bilir. İstemci (webrtc.js) bunu
        # room-state ile görüp kullanıcıya "devam etmek için ekranını tekrar seç"
        # istemi gösterir — tarayıcı güvenliği yüzünden video akışının kendisi F5'te
        # teknik olarak kaybolur, ama diğer katılımcıların ekranı ANİDEN KESİLMEZ.
        if meeting_code in self.active_screen_shares and str(self.active_screen_shares[meeting_code].get("presenter_id")) == user_id:
            self._cancel_pending_screen_share_stop(meeting_code)

        # EDİTÖR DEVRİ: Yeni katılımcı odaya eklendikten sonra tek editörü yeniden
        # hesapla — toplantı sahibi geri döndüyse ünvanını geri alır; hiç editör
        # yoksa ve bu kullanıcı ayrıcalıklıysa (admin/manager) editör O olur.
        old_editor = self.room_editors.get(meeting_code)
        new_editor = self._recompute_editor(meeting_code)

        # Bekleyen lobi talepleri artık SADECE o an editör olan kişiye gönderilir;
        # diğer ayrıcalıklı kullanıcılar ekran kalabalığı yaşamasın diye boş görür.
        pending_requests = list(self.pending_lobby_requests.get(meeting_code, {}).values()) if user_id == new_editor else []

        # İstemciye odanın durumunu ilet
        await websocket.send_text(json.dumps({
            "type": "room-state",
            "users": existing_participants,
            "pending_lobby_requests": pending_requests,
            "active_screen_share": self.active_screen_shares.get(meeting_code),
            "editor_id": new_editor
        }))

        await self._handle_editor_change(meeting_code, old_editor, new_editor, already_notified_user=user_id)

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

    async def disconnect(self, meeting_code: str, user_id: str, websocket: Optional[WebSocket] = None, grace_period_seconds: float = 4.0):
        """
        Kullanıcının bağlantısı koptuğunda Grace Period (4s) başlatır.
        Eğer ekran paylaşan sunucu ise ekran paylaşımı kendi Grace Period'unu
        (bkz. _schedule_screen_share_stop) başlatır — ANINDA kesilmez.
        """
        # BUG FIX (hayalet kopma / sahte "user-left"): Bu websocket artık
        # active_rooms'ta bu user_id için KAYITLI OLAN güncel bağlantı değilse
        # (kullanıcı bu soket kapanmadan ÖNCE zaten yeni bir bağlantıyla —
        # lobi->oda geçişi veya art arda hızlı F5 — yeniden bağlanmış demektir),
        # burada hiçbir şey yapmadan çık. Aksi halde hâlâ bağlı olan kullanıcı
        # için gereksiz bir grace-period/ekran-paylaşım-durdurma görevi
        # planlanır ve bu görev süresi dolduğunda kullanıcıyı yanlışlıkla
        # "ayrıldı" sayıp herkese sahte bir 'user-left' yayınlar.
        if websocket is not None:
            current_entry = self.active_rooms.get(meeting_code, {}).get(user_id)
            if isinstance(current_entry, dict) and current_entry.get("websocket") is not websocket:
                return

        # Ekran paylaşımı yapan kişi koptuysa/yenilediyse (F5) paylaşımı ANINDA
        # kesmek yerine kendi Grace Period'unu başlat — kısa süre içinde geri
        # dönerse diğer katılımcılar hiçbir kesinti görmez.
        if meeting_code in self.active_screen_shares and str(self.active_screen_shares[meeting_code].get("presenter_id")) == user_id:
            self._schedule_screen_share_stop(meeting_code, user_id)

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

    def _schedule_screen_share_stop(self, meeting_code: str, presenter_id: str):
        """SCREEN_SHARE_GRACE_SECONDS kadar bekler; süre dolana kadar kimse
        `_cancel_pending_screen_share_stop` çağırmazsa (ör. sunucu geri
        bağlanıp paylaşımı sürdürmezse) paylaşımı kesin olarak sonlandırır."""
        existing = self.pending_screen_share_stops.pop(meeting_code, None)
        if existing:
            existing.cancel()

        async def _delayed_stop():
            try:
                await asyncio.sleep(self.SCREEN_SHARE_GRACE_SECONDS)
            except asyncio.CancelledError:
                return  # Sunucu geri bağlandı / paylaşım sürüyor

            self.pending_screen_share_stops.pop(meeting_code, None)
            current = self.active_screen_shares.get(meeting_code)
            if current and str(current.get("presenter_id")) == str(presenter_id):
                self.active_screen_shares.pop(meeting_code, None)
                await self.broadcast_to_room(
                    meeting_code=meeting_code,
                    message={"type": "screen-share-stop"}
                )

        self.pending_screen_share_stops[meeting_code] = asyncio.create_task(_delayed_stop())

    def _cancel_pending_screen_share_stop(self, meeting_code: str):
        task = self.pending_screen_share_stops.pop(meeting_code, None)
        if task:
            task.cancel()

    async def _finalize_disconnect(self, meeting_code: str, user_id: str, explicit: bool = False):
        """Gerçekleşen kopmayı kesinleştirir ve odadakilere duyurur.

        BUG FIX: Bu metod hem 4sn'lik grace-period'un sonunda (doğal WS kopması)
        hem de kullanıcı "Ayrıl" butonuna basıp bunu bilinçli bildirdiğinde
        (bkz. routes/signaling.py 'user-left'+explicit) çağrılabiliyordu. İkisi
        de aynı kullanıcı için ayrı ayrı çağrılırsa 'user-left' iki kez
        yayınlanıp katılımcılara çift "X ayrıldı" bildirimi gösteriliyordu.
        `was_present` kontrolü, kullanıcı zaten (explicit çağrı ile) odadan
        çıkarılmışsa ikinci (grace-period kaynaklı) çağrının sessizce
        hiçbir şey yapmamasını sağlar.
        """
        was_present = False
        try:
            if meeting_code in self.active_rooms:
                popped = self.active_rooms[meeting_code].pop(user_id, None)
                was_present = popped is not None

                # BUG FIX: Ekran paylaşımı burada eskiden HER çağrıda (doğal
                # grace-period sonu DAHİL) sessizce (yayın yapmadan) siliniyordu.
                # Bu, F5 sırasında disconnect()'in kendi başlattığı ekran paylaşımı
                # Grace Period'unu (bkz. _schedule_screen_share_stop) es geçip
                # active_screen_shares kaydını erken/sessizce yok ediyor, sonucunda
                # "screen-share-stop" HİÇ yayınlanmıyor ve diğer katılımcıların
                # ekranı kalıcı biçimde donuk/tutarsız kalıyordu. Artık SADECE
                # bilinçli ayrılma/kick (explicit=True) durumunda burada ANINDA
                # sonlandırılıp duyurulur; doğal (F5/ağ) kopmalarda bu tamamen
                # bağımsız ekran-paylaşımı Grace Period'una bırakılır.
                if explicit and meeting_code in self.active_screen_shares and str(self.active_screen_shares[meeting_code].get("presenter_id")) == user_id:
                    self._cancel_pending_screen_share_stop(meeting_code)
                    self.active_screen_shares.pop(meeting_code, None)
                    await self.broadcast_to_room(
                        meeting_code=meeting_code,
                        message={"type": "screen-share-stop"}
                    )
        finally:
            if meeting_code in self.active_rooms:
                if not self.active_rooms[meeting_code]:
                    self.active_rooms.pop(meeting_code, None)
                    self.active_screen_shares.pop(meeting_code, None)
                    self.room_editors.pop(meeting_code, None)
                    self._cancel_pending_screen_share_stop(meeting_code)
                elif was_present:
                    message: Dict[str, Any] = {
                        "type": "user-left",
                        "sender_id": user_id,
                        "message": "Kullanıcı odadan ayrıldı."
                    }
                    if explicit:
                        message["explicit"] = True
                    await self.broadcast_to_room(meeting_code=meeting_code, message=message)

                    # EDİTÖR DEVRİ: Ayrılan kişi o an editörse (host veya devralmış
                    # yönetici), odada kalan bir sonraki ayrıcalıklı kullanıcıya
                    # (varsa) devret ve bekleyen lobi taleplerini ona ilet.
                    if self.room_editors.get(meeting_code) == user_id:
                        old_editor = user_id
                        new_editor = self._recompute_editor(meeting_code)
                        await self._handle_editor_change(meeting_code, old_editor, new_editor)

    async def kick_user(self, meeting_code: str, target_id: str, reason: str = "Kicked"):
        """Toplantıdan çıkarılan veya reddedilen kullanıcının soketini zorla kapatır."""
        disc_key = f"{meeting_code}:{target_id}"
        if disc_key in self.pending_disconnects:
            self.pending_disconnects.pop(disc_key).cancel()

        # NOT: Kullanıcı burada active_rooms'tan HENÜZ çıkarılmıyor — bunu tek bir yerden
        # (aşağıdaki _finalize_disconnect) yapıyoruz ki 'was_present' kontrolü doğru çalışsın
        # ve odadaki diğerlerine 'user-left' yayını (kick duyurusu) kaçırılmasın.
        user_data = self.active_rooms.get(meeting_code, {}).get(target_id)
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
        # explicit=True: kick edilen kişi kesinlikle geri dönmeyecek — hem
        # "ayrıldı" bildirimi hem (varsa) ekran paylaşımı kesme anında ve
        # duyurularak yapılmalı, 4-8sn'lik grace period'lar beklenmemeli.
        await self._finalize_disconnect(meeting_code, target_id, explicit=True)

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
        """Odadaki herkese mesaj yayınlar. Ölü bağlantıları anında temizler.

        NOT (performans): Gönderimler artık `asyncio.gather` ile EŞZAMANLI yapılıyor.
        Önceden sıralı (`for` + `await`) çalışıyordu; 15-20 katılımcılı bir odada tek bir
        yavaş/tıkanık soket, o mesajın herkese ulaşma süresini kümülatif olarak
        uzatıyordu (ör. birinin mikrofon durumu herkese sırayla, gecikmeli iletiliyordu).
        """
        if meeting_code not in self.active_rooms:
            return
        message_text = json.dumps(message)
        targets = [
            (user_id, user_data.get("websocket"))
            for user_id, user_data in self.active_rooms[meeting_code].items()
            if (not exclude_user or user_id != exclude_user) and isinstance(user_data, dict) and user_data.get("websocket")
        ]

        async def _send(user_id: str, ws: WebSocket):
            try:
                await ws.send_text(message_text)
                return None
            except Exception:
                return user_id

        results = await asyncio.gather(*(_send(uid, ws) for uid, ws in targets), return_exceptions=False)

        # BUG FIX: `await asyncio.gather(...)` sırasında event loop başka coroutine'lere
        # (ör. son katılımcının ayrılıp odayı tamamen boşaltan _finalize_disconnect'e)
        # de sıra veriyor. Bu yüzden gather bitene kadar `meeting_code` anahtarının
        # kendisi active_rooms'tan tamamen silinmiş olabilir; `[meeting_code]` ile
        # doğrudan erişim bu durumda KeyError fırlatıp arkadaki task'ı sessizce
        # çökertiyordu (asyncio "Task exception was never retrieved" logu).
        dead_users = [uid for uid in results if uid]
        room = self.active_rooms.get(meeting_code)
        if room:
            for dead_id in dead_users:
                room.pop(dead_id, None)

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