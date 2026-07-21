import datetime
from typing import List

from sqlalchemy.orm import Session
from uuid import UUID
from fastapi import HTTPException, status
from app.models.meeting_participant import MeetingParticipant
from app.schemas.participants import MeetingParticipantCreate, MeetingParticipantUpdate

def invite_user_to_meeting(db: Session, participant_data: MeetingParticipantCreate) -> MeetingParticipant:
    exists = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == participant_data.meeting_id,
        MeetingParticipant.user_id == participant_data.user_id
    ).first()
    if exists:
        return exists

    db_participant = MeetingParticipant(
        meeting_id=participant_data.meeting_id,
        user_id=participant_data.user_id,
        role=participant_data.role,
        status=participant_data.status,
        invited_at=datetime.utcnow()
    )
    db.add(db_participant)
    db.commit()
    db.refresh(db_participant)
    return db_participant

def get_meeting_participants(db: Session, meeting_id: UUID) -> List[MeetingParticipant]:
    return db.query(MeetingParticipant).filter(MeetingParticipant.meeting_id == meeting_id).all()

def update_participant_status_or_role(db: Session, meeting_id: UUID, user_id: UUID, update_data: MeetingParticipantUpdate) -> MeetingParticipant:
    participant = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting_id,
        MeetingParticipant.user_id == user_id
    ).first()
    if not participant:
        return None
        
    if update_data.status:
        participant.status = update_data.status
        if update_data.status == "joined" and not participant.joined_at:
            participant.joined_at = datetime.utcnow()
    if update_data.role:
        participant.role = update_data.role
        
    db.commit()
    db.refresh(participant)
    return participant

def remove_participant_from_meeting(db: Session, meeting_id: UUID, user_id: UUID) -> bool:
    participant = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting_id,
        MeetingParticipant.user_id == user_id
    ).first()
    if not participant:
        return False
    db.delete(participant)
    db.commit()
    return True