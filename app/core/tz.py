from datetime import datetime, timezone, timedelta

TURKEY_TZ = timezone(timedelta(hours=3))

def get_tr_now() -> datetime:
    """Türkiye Saat Diliminde (UTC+3) geçerli tarih ve saati tzinfo'suz döner."""
    return datetime.now(TURKEY_TZ).replace(tzinfo=None)

def to_tr_naive(dt: datetime) -> datetime:
    """Tarih nesnesini Türkiye Saat Dilimine (UTC+3) çevirip tzinfo'suz döner."""
    if dt is None:
        return None
    if getattr(dt, "tzinfo", None) is None:
        return dt
    return dt.astimezone(TURKEY_TZ).replace(tzinfo=None)
