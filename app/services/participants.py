from sqlalchemy.orm import Session
from uuid import UUID
from fastapi import HTTPException, status
from app.models.meeting_participant import MeetingParticipant
from app.schemas.participants import MeetingParticipantCreate, MeetingParticipantUpdate

def invite_user_to_meeting(db: Session, participant_data: MeetingParticipantCreate) -> MeetingParticipant:
    # Kullanıcının zaten bu toplantıya davet edilip edilmediğini kontrol et
    existing = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == participant_data.meeting_id,
        MeetingParticipant.user_id == participant_data.user_id
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bu kullanıcı zaten bu toplantıya davet edilmiş veya katılmış."
        )

    db_participant = MeetingParticipant(
        meeting_id=participant_data.meeting_id,
        user_id=participant_data.user_id,
        role=participant_data.role,
        status="invited"
    )
    db.add(db_participant)
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