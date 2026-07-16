from app.core.database import Base
from app.models.department import Department
from app.models.user import User
from app.models.meeting import Meeting
from app.models.meeting_participant import MeetingParticipant
from app.models.participant_session import ParticipantSession
from app.models.meeting_note import MeetingNote
from app.models.meeting_action import MeetingAction
from app.models.notification import Notification
from app.models.api_client import ApiClient
from app.models.webhook_log import WebhookLog
from app.models.department import Department
# Alembic'in tek bir noktadan tüm veritabanı şemasını tanımasını sağlıyoruz
__all__ = [
    "Base",
    "Department",
    "User",
    "Meeting",
    "MeetingParticipant",
    "ParticipantSession",
    "MeetingNote",
    "MeetingAction",
    "Notification",
    "ApiClient",
    "WebhookLog"
]