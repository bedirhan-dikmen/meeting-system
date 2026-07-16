import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Depends, status
from sqlalchemy.orm import Session
from uuid import UUID
from app.core.database import SessionLocal
# Sizin security dosyanızda kesinlikle var olan get_current_user fonksiyonunu çağırıyoruz
from app.core.security import get_current_user
from app.models.meeting import Meeting
from app.services.signaling import signaling_manager

router = APIRouter()

def get_db():
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
    # 1. Güvenlik Kontrolü: get_current_user fonksiyonunu veritabanı oturumu ve token ile tetikliyoruz
    db = SessionLocal()
    try:
        # Mevcut security mimarinize doğrudan token string'ini geçiriyoruz
        current_user = get_current_user(db=db, token=token)
        if not current_user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    finally:
        db.close()

    user_id_str = str(current_user.id)

    # 2. Toplantı Odası Kontrolü
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.meeting_code == meeting_code).first()
    db.close()

    if not meeting:
        await websocket.close(code=status.WS_1011_UNEXPECTED_CONDITION)
        return

    # 3. Bağlantıyı Kabul Et ve Odaya Kaydet
    await signaling_manager.connect(meeting_code=meeting_code, user_id=user_id_str, websocket=websocket)

    try:
        while True:
            data_text = await websocket.receive_text()
            data = json.loads(data_text)

            target_id = data.get("target_id")
            data["sender_id"] = user_id_str

            if target_id:
                await signaling_manager.send_targeted_message(
                    meeting_code=meeting_code,
                    recipient_id=target_id,
                    message=data
                )
            else:
                await signaling_manager.broadcast_to_room(
                    meeting_code=meeting_code,
                    message=data,
                    exclude_user=user_id_str
                )

    except WebSocketDisconnect:
        await signaling_manager.disconnect(meeting_code=meeting_code, user_id=user_id_str)

@router.get("/ws-info", tags=["Canlı Sinyalleşme"])
def websocket_info():
    """
    ### 🔌 Canlı WebRTC Sinyalleşme WebSocket Bağlantı Rehberi
    
    Bu modül, canlı toplantı odalarındaki WebRTC el sıkışmalarını (SDP Offer, Answer ve ICE Candidate) gerçek zamanlı yönetir.
    
    * **WebSocket Adresi:** `ws://127.0.0.1:8000/api/v1/ws/{meeting_code}?token={jwt_token}`
    * **meeting_code:** Toplantıya ait benzersiz kod (Örn: `yeb-xxxx-xxxx`)
    * **token:** Sisteme giriş yaptıktan sonra aldığınız JWT Access Token string'i.
    
    #### Sinyal Paketi Taslak Formatı (JSON):
    ```json
    {
        "type": "video-offer",
        "target_id": "hedef_kullanici_uuid_degeri",
        "sdp": "..."
    }
    ```
    """
    return {
        "websocket_url": "ws://127.0.0.1:8000/api/v1/ws/{meeting_code}",
        "protocol": "WebSocket",
        "requires_auth": True
    }