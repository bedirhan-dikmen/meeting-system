import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base

from app.core.tz import get_tr_now

class WebhookLog(Base):
    __tablename__ = "webhook_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_type = Column(String, nullable=False)  # meeting.started, meeting.ended
    target_url = Column(String, nullable=False)
    payload = Column(Text, nullable=False)  # Gönderilen JSON paket içeriği
    response_status = Column(Integer, nullable=True)  # HTTP Status (200, 500 vb.)
    response_body = Column(Text, nullable=True)
    delivered_at = Column(DateTime, default=get_tr_now, nullable=False)