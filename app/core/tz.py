from datetime import datetime, timezone, timedelta

TURKEY_TZ = timezone(timedelta(hours=3))

def get_tr_now() -> datetime:
    """Türkiye Saat Diliminde (UTC+3) geçerli tarih ve saati tzinfo'suz döner."""
    return datetime.now(TURKEY_TZ).replace(tzinfo=None)
