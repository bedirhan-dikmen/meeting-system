from sqlalchemy.orm import Session
from uuid import UUID
from fastapi import HTTPException, status
from app.models.meeting_participant import MeetingParticipant
from app.schemas.participants import MeetingParticipantCreate, MeetingParticipantUpdate

def invite_user_to_meeting(db: Session, participant_data: MeetingParticipantCreate) -> MeetingParticipant:
    from app.models.notification import Notification
    from app.models.meeting import Meeting

    # Meeting bilgisini al
    meeting = db.query(Meeting).filter(Meeting.id == participant_data.meeting_id).first()
    m_code = meeting.meeting_code if meeting else None
    m_title = meeting.title if meeting else "Toplantı"

    # Kullanıcının zaten bu toplantıya davet edilip edilmediğini kontrol et
    existing = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == participant_data.meeting_id,
        MeetingParticipant.user_id == participant_data.user_id
    ).first()

    if existing:
        notif = Notification(
            user_id=participant_data.user_id,
            title="Toplantı Daveti",
            message=f"'{m_title}' toplantısına katılmanız için hatırlatma daveti gönderildi.",
            meeting_code=m_code
        )
        db.add(notif)
        db.commit()
        return existing

    db_participant = MeetingParticipant(
        meeting_id=participant_data.meeting_id,
        user_id=participant_data.user_id,
        role=participant_data.role or "participant",
        status="invited"
    )
    db.add(db_participant)

    notif = Notification(
        user_id=participant_data.user_id,
        title="Yeni Toplantı Daveti",
        message=f"'{m_title}' toplantısına davet edildiniz.",
        meeting_code=m_code
    )
    db.add(notif)

    db.commit()
    db.refresh(db_participant)
    return db_participant

def get_meeting_participants(db: Session, meeting_id: UUID):
    return db.query(MeetingParticipant).filter(MeetingParticipant.meeting_id == meeting_id).all()

def update_participant_status_or_role(
    db: Session, 
    meeting_id: UUID, 
    user_id: UUID, 
    update_data: MeetingParticipantUpdate
) -> MeetingParticipant:
    participant = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting_id,
        MeetingParticipant.user_id == user_id
    ).first()

    if not participant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Toplantıda böyle bir katılımcı kaydı bulunamadı."
        )

    # Güncellenecek alanları eşleştir
    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(participant, key, value)

    db.commit()
    db.refresh(participant)
    return participant

def remove_participant_from_meeting(db: Session, meeting_id: UUID, user_id: UUID) -> bool:
    participant = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting_id,
        MeetingParticipant.user_id == user_id
    ).first()

    if not participant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Katılımcı kaydı bulunamadı."
        )

    db.delete(participant)
    db.commit()
    return True