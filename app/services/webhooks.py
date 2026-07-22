import httpx
import logging
import json
from sqlalchemy import select
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime, timezone
from typing import Dict, Any
from app.core.database import SessionLocal  # Arka plan taskı için bağımsız session köprüsü
from app.models.webhook_log import WebhookLog  # Senin mevcuttaki gerçek log modelin!

logger = logging.getLogger("webhook_service")

async def send_and_log_webhook(target_url: str, event_name: str, payload_data: Dict[str, Any]):
    """ harici URL'e HTTP POST isteği atar ve sonucunu WebhookLog tablonuza yazar."""
    status_code = None
    response_text = ""
    
    # 1. Dış Sisteme İsteği Fırlat
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(target_url, json=payload_data, timeout=5.0)
            status_code = response.status_code
            response_text = response.text[:1000]  # İlk 1000 karakteri kırpıp güvenli saklıyoruz
        except Exception as e:
            status_code = 0
            response_text = f"HTTP Baglanti Hatasi: {str(e)}"
            logger.error(f"Webhook HTTP hatasi. URL: {target_url}, Hata: {str(e)}")

    # 2. Arka Planda Yeni Bir DB Session Aç ve Sonucu Tabloya Logla
    db: Session = SessionLocal()
    try:
        db_log = WebhookLog(
            event_type=event_name,  # Tablonuzda 'event_name' ise onunla esleyin hocam
            payload=json.dumps(payload_data), # JSON'ı string'e cevirip basıyoruz
            response_status=status_code,      # Tablonuzdaki kolon adına gore senkron edin
            response_body=response_text,
            created_at=datetime.now(timezone.utc)
        )
        db.add(db_log)
        db.commit()
    except Exception as db_err:
        db.rollback()
        logger.error(f"Webhook veritabanina loglanirken hata olustu: {str(db_err)}")
    finally:
        db.close()

def trigger_webhook_event(db: Session, event_name: str, payload: Dict[str, Any], background_tasks: Any):
    """Sistem olayini yakalar ve harici entegrasyon hedeflerine arka planda dagitir."""
    # NOT: Harici sistemlerin dinamik hedefleri icin sabit bir URL tanimlayabilir 
    # veya ileride WebhookSubscription eklediginizde oraya baglayabilirsiniz.
    # Simdilik testleri yurutmek adina kurumsal simule bir entegrasyon URL'i kullaniyoruz:
    target_url = "https://api.company-crm.internal/v1/webhooks"
    
    payload_data = {
        "event": event_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": payload
    }

    # FastAPI BackgroundTasks ile ana thread kilitlenmeden loglama ve HTTP sureci akip gider
    background_tasks.add_task(send_and_log_webhook, target_url, event_name, payload_data)