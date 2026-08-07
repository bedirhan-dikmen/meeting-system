from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from app.core.database import get_db
from app.core.security import get_current_user, verify_meeting_access
from app.models.user import User
from app.models.meeting import Meeting
from app.schemas.participants import (
    MeetingParticipantCreate,
    MeetingParticipantOut,
    MeetingParticipantUpdate
)
from app.services.participants import (
    invite_user_to_meeting,
    get_meeting_participants,
    update_participant_status_or_role,
    remove_participant_from_meeting
)

router = APIRouter()

# Bir toplantı içinde "ayrıcalıklı" sayılan roller — editör/host, sistem admini
# ve devredilmiş moderatör/co-host. verify_meeting_access bu string'i host/admin
# için kendisi üretir, sıradan katılımcılar için ise participant.role'ü döner.
PRIVILEGED_PARTICIPANT_ROLES = {"host", "admin", "moderator", "co_host"}


@router.post("/invite", response_model=MeetingParticipantOut, status_code=status.HTTP_201_CREATED)
def invite_user(
    payload: MeetingParticipantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Sisteme kayıtlı bir kullanıcıyı UUID tabanlı toplantıya davet eder.

    GÜVENLİK FIX: Bu uç eskiden HERHANGİ bir giriş yapmış kullanıcının, hiç
    ilgisi olmadığı bir toplantıya -- hatta kendini "host"/"moderator"
    rolüyle -- eklemesine izin veriyordu; bu kayıt sonrasında
    verify_meeting_access kullanıcıyı gerçek bir katılımcı sayıp toplantının
    notlarına, raporuna ve katılımcı listesine tam erişim veriyordu (IDOR).
    Artık sadece toplantıyı oluşturan (editör) veya sistem admin/manager'ı
    davet gönderebilir.
    """
    meeting = db.query(Meeting).filter(Meeting.id == payload.meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Toplantı bulunamadı.")

    is_creator = meeting.created_by == current_user.id
    is_privileged_role = str(getattr(current_user, "role", "")).lower() in ("admin", "manager")
    if not (is_creator or is_privileged_role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu toplantıya katılımcı davet etme yetkiniz bulunmuyor."
        )

    return invite_user_to_meeting(db, participant_data=payload)


@router.get("/{meeting_id}", response_model=List[MeetingParticipantOut])
def read_participants(
    meeting_id: UUID,
    db: Session = Depends(get_db),
    access_claims: dict = Depends(verify_meeting_access)
):
    """
    Belirli bir toplantıya ait tüm katılımcıların listesini getirir (Yetki sarmalayıcısı korumalı).
    """
    return get_meeting_participants(db, meeting_id=meeting_id)


@router.put("/{meeting_id}/users/{user_id}", response_model=MeetingParticipantOut)
def update_participant(
    meeting_id: UUID,
    user_id: UUID,
    payload: MeetingParticipantUpdate,
    db: Session = Depends(get_db),
    access_claims: dict = Depends(verify_meeting_access)
):
    """
    Katılımcının odadaki rolünü veya katılım durumunu (invited, joined, left vb.) günceller.

    GÜVENLİK FIX: Bu uç eskiden sadece "giriş yapmış olmak" istiyordu -- çağıranın
    bu toplantıyla hiçbir ilgisi olmasına gerek yoktu, herhangi bir kullanıcı
    başka birinin rolünü "host"a yükseltebiliyor ya da durumunu değiştirebiliyordu.
    Artık verify_meeting_access bariyerinden geçmek (toplantının gerçek bir
    katılımcısı/sahibi/admini olmak) zorunlu. Rol değişikliği SADECE editör/admin/
    moderator gibi ayrıcalıklı kullanıcılara açık; sıradan bir katılımcı yalnızca
    KENDİ durumunu (status -- ör. daveti kabul/red) güncelleyebilir, kendi rolünü
    dahi değiştiremez.
    """
    caller_id = access_claims.get("user_id")
    caller_role = str(access_claims.get("role", "")).lower()
    is_privileged = caller_role in PRIVILEGED_PARTICIPANT_ROLES
    is_self = str(caller_id) == str(user_id)

    if not is_privileged:
        if not is_self:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Sadece kendi katılım durumunuzu güncelleyebilirsiniz."
            )
        if payload.role is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Kendi rolünüzü değiştirme yetkiniz bulunmuyor."
            )

    return update_participant_status_or_role(
        db, meeting_id=meeting_id, user_id=user_id, update_data=payload
    )


@router.delete("/{meeting_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_participant(
    meeting_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),
    access_claims: dict = Depends(verify_meeting_access)
):
    """
    Bir katılımcıyı toplantı listesinden tamamen siler.

    GÜVENLİK FIX: Aynı şekilde artık sadece toplantı editörü/admin/moderatörü
    başka birini çıkarabilir; sıradan bir katılımcı yalnızca KENDİ kaydını
    (toplantıdan ayrılma) silebilir.
    """
    caller_id = access_claims.get("user_id")
    caller_role = str(access_claims.get("role", "")).lower()
    is_privileged = caller_role in PRIVILEGED_PARTICIPANT_ROLES
    is_self = str(caller_id) == str(user_id)

    if not is_privileged and not is_self:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu katılımcıyı çıkarma yetkiniz bulunmuyor."
        )

    remove_participant_from_meeting(db, meeting_id=meeting_id, user_id=user_id)
    return None
