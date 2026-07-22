from fastapi import APIRouter, Depends, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.webhooks import WebhookSubscriptionOut, WebhookSubscriptionCreate

router = APIRouter(prefix="/webhooks", tags=["Webhook Entegrasyon Yönetimi"])

@router.post("/subscribe", response_model=WebhookSubscriptionOut, status_code=status.HTTP_201_CREATED)
def subscribe_to_events(
    payload: WebhookSubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Harici bir sistemi sistem event akışına (Webhook) abone eder."""
    from datetime import datetime, timezone
    import uuid
    return {
        "id": uuid.uuid4(),
        "target_url": payload.target_url,
        "events": payload.events,
        "is_active": True,
        "created_at": datetime.now(timezone.utc)
    }