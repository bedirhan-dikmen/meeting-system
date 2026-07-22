from datetime import timezone
from datetime import datetime
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

    # 2. Toplantı Odası Kontrolü & Otomatik Başlatma Logu
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.meeting_code == meeting_code).first()

    if not meeting:
        db.close()
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return

    # Otomatik Başlatma: Statüyü ACTIVE yap
    if meeting.status in ["planlandı", "taslak"]:
        meeting.status = "ACTIVE"
        if not meeting.actual_start:
            meeting.actual_start = datetime.now(timezone.utc)
        db.commit()

    # Katılımcı Oturumu (ParticipantSession) Başlat
    from app.models.participant_session import ParticipantSession
    session_entry = ParticipantSession(
        meeting_id=meeting.id,
        user_id=current_user.id,
        joined_at=datetime.now(timezone.utc)
    )
    db.add(session_entry)
    db.commit()
    session_id = session_entry.id
    db.close()

    user_info = {
        "id": user_id_str,
        "name": f"{current_user.first_name or ''} {current_user.last_name or ''}".strip() or "Kullanıcı",
        "email": current_user.email,
        "role": current_user.role,
        "avatar_url": getattr(current_user, 'avatar_url', None)
    }

    # 3. Bağlantıyı Kabul Et ve Odaya Kaydet
    await signaling_manager.connect(
        meeting_code=meeting_code,
        user_id=user_id_str,
        websocket=websocket,
        user_info=user_info
    )

    try:
        while True:
            data_text = await websocket.receive_text()
            data = json.loads(data_text)

            target_id = data.get("target_id")
            data["sender_id"] = user_id_str

            if data.get("type") == "user-state-update":
                await signaling_manager.update_user_info(meeting_code, user_id_str, data)

            if data.get("type") == "screen-share-start":
                signaling_manager.active_screen_shares[meeting_code] = {
                    "presenter_id": user_id_str,
                    "presenter_name": data.get("presenter_name", "Katılımcı")
                }

            if data.get("type") == "screen-share-stop":
                if meeting_code in signaling_manager.active_screen_shares:
                    del signaling_manager.active_screen_shares[meeting_code]

            # Host toplantıyı bitirdiğinde DB güncellemesi
            if data.get("type") == "meeting-ended":
                db_end = SessionLocal()
                m_end = db_end.query(Meeting).filter(Meeting.meeting_code == meeting_code).first()
                if m_end:
                    m_end.status = "tamamlandı"
                    m_end.actual_end = datetime.now(timezone.utc)
                    db_end.commit()
                db_end.close()

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
        # Katılımcı Oturum Bitiş Logu
        db_disc = SessionLocal()
        s_entry = db_disc.query(ParticipantSession).filter(ParticipantSession.id == session_id).first()
        if s_entry and not s_entry.left_at:
            now_utc = datetime.now(timezone.utc)
            s_entry.left_at = now_utc
            joined = s_entry.joined_at
            if joined:
                if joined.tzinfo is None:
                    joined = joined.replace(tzinfo=timezone.utc)
                s_entry.duration_seconds = max(0, int((now_utc - joined).total_seconds()))
            db_disc.commit()
        db_disc.close()


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