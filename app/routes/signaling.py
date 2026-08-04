from datetime import timezone
from datetime import datetime
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Depends, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional
from app.core.database import SessionLocal
from app.core.tz import get_tr_now
# Sizin security dosyanızda kesinlikle var olan get_current_user fonksiyonunu çağırıyoruz
from app.core.security import get_current_user
from app.models.user import User
from app.models.meeting import Meeting
from app.models.participant_session import ParticipantSession
from app.models.meeting_participant import MeetingParticipant
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
    token: Optional[str] = Query(None, description="Kayıtlı kullanıcı JWT token'ı"),
    guest_token: Optional[str] = Query(None, description="Misafir erişim token'ı"),
    in_lobby: Optional[bool] = Query(False, description="Bekleme odası bayrağı")
):
    # ── Auth: JWT veya guest_token ───────────────────────────────────────────
    is_guest = False
    user_id_str = None
    user_info = {}

    if guest_token:
        # Misafir yolu: HMAC / JWT token doğrula
        from app.routes.guest import validate_guest_token
        payload = validate_guest_token(guest_token)
        if not payload:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        token_meeting_code = payload.get("meeting_code")
        if token_meeting_code and token_meeting_code != meeting_code:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        is_guest = True
        user_id_str = payload.get("guest_id") or payload.get("sub")
        guest_name = payload.get("guest_name", "Misafir Katılımcı")
        user_info = {
            "id": user_id_str,
            "name": guest_name,
            "email": "",
            "role": "guest",
            "avatar_url": None,
            "isMicMuted": True,
            "isCameraOff": True,
            "is_guest": True,
            "in_lobby": bool(in_lobby)
        }
    elif token:
        # Kayıtlı kullanıcı yolu: mevcut JWT doğrulama
        db = SessionLocal()
        try:
            current_user = get_current_user(db=db, token=token)
            if not current_user:
                print("[WS AUTH] get_current_user returned None for token.")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
        except Exception as err:
            print(f"[WS AUTH ERROR] JWT verification failed: {err}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        finally:
            db.close()

        user_id_str = str(current_user.id)
        user_info = {
            "id": user_id_str,
            "name": f"{current_user.first_name or ''} {current_user.last_name or ''}".strip() or "Kullanıcı",
            "email": current_user.email,
            "role": current_user.role,
            "avatar_url": getattr(current_user, 'avatar_url', None),
            "isMicMuted": True,
            "isCameraOff": True,
            "in_lobby": bool(in_lobby)
        }
    else:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # ── Toplantı kontrolü ────────────────────────────────────────────────────
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.meeting_code == meeting_code).first()

    if not meeting:
        db.close()
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return

    session_id = None

    if not is_guest:
        # Kayıtlı kullanıcı: oturum ve katılımcı kaydı
        try:
            user_uuid = UUID(user_id_str)
            if meeting.status in ["planlandı", "taslak"]:
                meeting.status = "ACTIVE"
                if meeting.actual_start is None:
                    meeting.actual_start = get_tr_now()
                db.commit()

            session_entry = ParticipantSession(
                meeting_id=meeting.id,
                user_id=user_uuid,
                joined_at=get_tr_now()
            )
            db.add(session_entry)

            existing_p = db.query(MeetingParticipant).filter(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.user_id == user_uuid
            ).first()
            if not existing_p:
                db.add(MeetingParticipant(
                    meeting_id=meeting.id,
                    user_id=user_uuid,
                    role="host" if meeting.created_by == user_uuid else "participant",
                    status="joined"
                ))

            db.commit()
            session_id = session_entry.id
        except Exception:
            db.rollback()

    if not user_id_str:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # ── WebSocket bağlantısını kur ───────────────────────────────────────────
    await signaling_manager.connect(
        meeting_code=meeting_code,
        user_id=user_id_str,
        websocket=websocket,
        user_info=user_info
    )

    try:
        while True:
            data_text = await websocket.receive_text()
            try:
                data = json.loads(data_text)
            except (json.JSONDecodeError, TypeError):
                continue

            if not isinstance(data, dict):
                continue

            target_id = data.get("target_id")
            data["sender_id"] = user_id_str

            if data.get("type") == "user-joined":
                user_info_val = data.get("user_info")
                # F5 Yenileme durumunu kontrol et ve is_reconnect bayrağını koru
                disc_key = f"{meeting_code}:{user_id_str}"
                is_reconn = data.get("is_reconnect", False) or (user_id_str in signaling_manager.active_rooms.get(meeting_code, {}))
                data["is_reconnect"] = is_reconn
                if isinstance(user_info_val, dict):
                    await signaling_manager.update_user_info(meeting_code, user_id_str, user_info_val)

            if data.get("type") == "user-state-update":
                state_info_val = data.get("user_info") if isinstance(data.get("user_info"), dict) else data
                if isinstance(state_info_val, dict):
                    await signaling_manager.update_user_info(meeting_code, user_id_str, state_info_val)

            if data.get("type") == "screen-share-start":
                signaling_manager.active_screen_shares[meeting_code] = {
                    "presenter_id": user_id_str,
                    "presenter_name": data.get("presenter_name", "Katılımcı"),
                    "stream_id": data.get("stream_id")
                }

            if data.get("type") == "screen-share-stop":
                if meeting_code in signaling_manager.active_screen_shares:
                    del signaling_manager.active_screen_shares[meeting_code]

            if data.get("type") == "lobby-join-request":
                user_info_val = data.get("user_info") if isinstance(data.get("user_info"), dict) else user_info
                await signaling_manager.add_pending_lobby_request(
                    meeting_code=meeting_code,
                    user_id=user_id_str,
                    user_info=user_info_val
                )
                continue

            if data.get("type") == "lobby-approve" and target_id:
                await signaling_manager.approve_lobby_user(meeting_code, target_id)
                continue

            if data.get("type") == "lobby-reject" and target_id:
                await signaling_manager.reject_lobby_user(meeting_code, target_id)
                continue

            if data.get("type") == "guest-join-response":
                if target_id:
                    if data.get("approved") is True:
                        # BUG FIX: Lobi onayı — misafire 'lobby-approved' sinyali gönder
                        await signaling_manager.approve_lobby_user(meeting_code, target_id)
                    else:
                        # Reddedildi — misafiri odadan çıkar
                        await signaling_manager.kick_user(meeting_code, target_id, reason="Rejected")
                continue

            if data.get("type") == "host-kick" and target_id:
                await signaling_manager.kick_user(meeting_code, target_id, reason="Kicked")
                continue

            # Host toplantıyı bitirdiğinde DB güncellemesi
            if data.get("type") == "meeting-ended":
                db_end = SessionLocal()
                try:
                    m_end = db_end.query(Meeting).filter(Meeting.meeting_code == meeting_code).first()
                    if m_end:
                        m_end.status = "tamamlandı"
                        m_end.actual_end = get_tr_now()
                        db_end.commit()
                except Exception:
                    db_end.rollback()
                finally:
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

    except (WebSocketDisconnect, Exception):
        await signaling_manager.disconnect(meeting_code=meeting_code, user_id=user_id_str)
        # Katılımcı Oturum Bitiş Logu
        if session_id:
            db_disc = SessionLocal()
            try:
                s_entry = db_disc.query(ParticipantSession).filter(ParticipantSession.id == session_id).first()
                if s_entry and not s_entry.left_at:
                    now_tr = get_tr_now()
                    s_entry.left_at = now_tr
                    joined = s_entry.joined_at
                    if joined:
                        s_entry.duration_seconds = max(0, int((now_tr - joined).total_seconds()))
                    db_disc.commit()
            except Exception:
                db_disc.rollback()
            finally:
                db_disc.close()


@router.get("/ws-info", tags=["Canlı Sinyalleşme"])
def websocket_info():
    """
    ### 🔌 Canlı WebRTC Sinyalleşme WebSocket Bağlantı Rehberi
    
    Bu modül, canlı toplantı odalarındaki WebRTC el sıkışmalarını (SDP Offer, Answer ve ICE Candidate) gerçek zamanlı yönetir.
    
    * **WebSocket Adresi:** `ws://127.0.0.1:8000/api/v1/signaling/ws/{meeting_code}?token={jwt_token}`
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
        "websocket_url": "ws://127.0.0.1:8000/api/v1/signaling/ws/{meeting_code}",
        "protocol": "WebSocket",
        "requires_auth": True
    }


@router.get("/lobby/{meeting_code}")
def get_pending_lobby_requests(
    meeting_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Toplantı odasında onay bekleyen lobi katılımcılarının listesini döner."""
    requests = list(signaling_manager.pending_lobby_requests.get(meeting_code, {}).values())
    return {"pending_requests": requests}