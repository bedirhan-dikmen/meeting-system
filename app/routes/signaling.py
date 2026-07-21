# app/routes/signaling.py
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Depends, status
from sqlalchemy.orm import Session
from uuid import UUID
from app.core.database import SessionLocal
from app.core.security import get_current_user
from app.models.meeting import Meeting
from app.services.signaling import signaling_manager

router = APIRouter()

def get_db():
    """Her WebSocket yaşam döngüsü için izole veritabanı oturumu sağlar."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.websocket("/ws/{meeting_code}")
async def websocket_endpoint(
    websocket: WebSocket,
    meeting_code: str,
    token: str = Query(..., description="Doğrulama için JWT access_token")
):
    """
    Canlı oda içerisindeki WebRTC el sıkışmalarını, anlık sohbet (Chat) mesajlarını
    ve sistem içi olay yayınlarını asenkron yöneten ana WebSocket uç noktası.
    """
    db = SessionLocal()
    current_user = None
    
    # 1. GÜVENLİK VE TOKEN DOĞRULAMA KATMANI
    try:
        current_user = get_current_user(db=db, token=token)
        if not current_user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    finally:
        db.close()

    # Kullanıcı benzersiz kimliğini string formatına getir
    user_id_str = str(current_user.id)
    user_full_name = f"{current_user.first_name or ''} {current_user.last_name or ''}".strip() or current_user.email

    # 2. BAĞLANTIYI KABUL ET VE ODA ODASINA KAYDET
    await signaling_manager.connect(websocket=websocket, meeting_code=meeting_code, user_id=user_id_str)
    
    try:
        while True:
            # İstemciden (Frontend / room.js) gelen ham metni (JSON) dinle
            data = await websocket.receive_text()
            
            try:
                packet = json.loads(data)
            except json.JSONDecodeError:
                continue  # Geçersiz JSON formatlarını baypas et

            # 3. OLAY VE SİNYAL YÖNLENDİRME MOTORU
            event_type = packet.get("type") or packet.get("event")
            target_id = packet.get("target_id")

            # Eğer gelen paket bir canlı sohbet mesajı ise paketi zenginleştir ve odaya dağıt
            if event_type == "CHAT_MESSAGE":
                chat_packet = {
                    "event": "CHAT_MESSAGE",
                    "sender": user_full_name,
                    "message": packet.get("message", ""),
                    "user_id": user_id_str
                }
                # Kendisi hariç odadaki tüm kullanıcılara mesajı fırlat
                await signaling_manager.broadcast_to_room(
                    meeting_code=meeting_code,
                    message=json.dumps(chat_packet),
                    exclude_user=user_id_str
                )
            
            # WebRTC Sinyalleşme Paketleri (video-offer, video-answer, new-ice-candidate)
            else:
                if target_id:
                    # Nokta atışı hedef kullanıcıya (Peer-to-Peer) sinyali gönder
                    await signaling_manager.send_targeted_message(
                        meeting_code=meeting_code,
                        recipient_id=str(target_id),
                        message=data
                    )
                else:
                    # Genel oda yayını yap (Herkesi senkronize et)
                    await signaling_manager.broadcast_to_room(
                        meeting_code=meeting_code,
                        message=data,
                        exclude_user=user_id_str
                    )

    except WebSocketDisconnect:
        # 4. KOPMA / ODADAN AYRILMA DURUMU YÖNETİMİ
        await signaling_manager.disconnect(meeting_code=meeting_code, user_id=user_id_str)
        
        # Odadaki diğer kişilere kullanıcının ayrıldığını anlık bildir
        leave_packet = {
            "event": "PARTICIPANT_LEFT",
            "user_id": user_id_str,
            "name": user_full_name
        }
        await signaling_manager.broadcast_to_room(
            meeting_code=meeting_code,
            message=json.dumps(leave_packet),
            exclude_user=user_id_str
        )

@router.get("/ws-info", tags=["Canlı Sinyalleşme Bilgi Hattı"])
def websocket_info():
    """
    ### 🔌 Canlı WebRTC Sinyalleşme WebSocket Bağlantı Rehberi
    
    Bu modül, canlı toplantı odalarındaki WebRTC el skullanımlarını, anlık not takaslarını
    ve canlı sohbet (Chat) paketlerini gerçek zamanlı asenkron yönetir.
    
    * **WebSocket Tam Adresi:** `ws://127.0.0.1:8000/api/v1/ws/{meeting_code}?token={jwt_token}`
    * **meeting_code:** Toplantıya ait benzersiz oda erişim kodu (Örn: `yeb-xxxx-xxxx`)
    * **token:** Giriş sonrası localStorage üzerinde saklanan JWT Access Token string'i.
    """
    return {
        "gateway": "Yebsoft WebSocket Signaling Gateway Active",
        "protocol": "WebSockets (RFC 6455)",
        "supported_events": ["video-offer", "video-answer", "new-ice-candidate", "CHAT_MESSAGE"]
    }