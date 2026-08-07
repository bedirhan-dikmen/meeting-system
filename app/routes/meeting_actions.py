from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List
from app.core.database import get_db
from app.core.security import get_current_user, verify_meeting_access
from app.models.user import User
from app.models.meeting_action import MeetingAction
from app.schemas.meeting_actions import MeetingActionOut, MeetingActionCreate
from app.services import meeting_actions as action_service

router = APIRouter(prefix="/actions", tags=["Toplantı Aksiyon Kararları"])


@router.post("/", response_model=MeetingActionOut, status_code=status.HTTP_201_CREATED)
def create_meeting_action(
    payload: MeetingActionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Toplantıda alınan yeni bir aksiyon kararını/görevini ekler.

    GÜVENLİK FIX: Bu uç eskiden sadece "giriş yapmış olmak" istiyordu; hiçbir
    ilgisi olmayan bir kullanıcı, meeting_id'sini bilerek başka bir toplantıya
    keyfi görev enjekte edebiliyordu. `verify_meeting_access`, meeting_id path
    parametresi gerektirdiğinden burada dependency olarak kullanılamıyor -- bu
    yüzden aynı yetki kontrolü meeting_notes.py'deki desenle birebir burada
    manuel uygulanıyor: sadece toplantının gerçek bir katılımcısı/sahibi/admini
    görev ekleyebilir.
    """
    _ensure_meeting_member(db, payload.meeting_id, current_user)

    return action_service.create_action(db, action_data=payload, creator_id=current_user.id)


@router.get("/meeting/{meeting_id}", response_model=List[MeetingActionOut])
def read_meeting_actions(
    meeting_id: UUID,
    db: Session = Depends(get_db),
    access_claims: dict = Depends(verify_meeting_access)
):
    """Bir toplantıdaki tüm aksiyon görevlerini listeler (Yetki sarmalayıcısı korumalı)."""
    return action_service.get_meeting_actions(db, meeting_id=meeting_id)


@router.put("/{action_id}/status", response_model=MeetingActionOut)
def update_action_completion(
    action_id: UUID,
    is_completed: bool,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Görev tamamlanma durumunu günceller.

    GÜVENLİK FIX: action_id üzerinden herhangi bir toplantının herhangi bir
    görevi -- hiç ilgisi olmayan kullanıcılarca -- tamamlandı/tamamlanmadı
    olarak işaretlenebiliyordu. Önce görevin ait olduğu toplantı bulunur,
    ardından çağıranın o toplantının gerçek bir katılımcısı/sahibi/admini
    olduğu doğrulanır.
    """
    db_action = db.get(MeetingAction, action_id)
    if not db_action:
        raise HTTPException(status_code=404, detail="Aksiyon kararı bulunamadı.")

    _ensure_meeting_member(db, db_action.meeting_id, current_user)

    action = action_service.update_action_status(db, action_id=action_id, is_completed=is_completed)
    if not action:
        raise HTTPException(status_code=404, detail="Aksiyon kararı bulunamadı.")
    return action


def _ensure_meeting_member(db: Session, meeting_id: UUID, current_user: User) -> None:
    """Çağıranın verilen toplantının sahibi/admini/gerçek katılımcısı olduğunu doğrular."""
    from app.models.meeting import Meeting
    from app.models.meeting_participant import MeetingParticipant

    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Toplantı bulunamadı.")

    is_creator = meeting.created_by == current_user.id
    is_privileged_role = str(getattr(current_user, "role", "")).lower() in ("admin", "manager")
    if is_creator or is_privileged_role:
        return

    participant = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting_id,
        MeetingParticipant.user_id == current_user.id
    ).first()
    if not participant or participant.status in ["REJECTED", "declined"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu toplantının aksiyon kararları üzerinde yetkiniz bulunmuyor."
        )
