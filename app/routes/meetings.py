# app/routes/meetings.py
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import get_current_user_claims
from app.models.user import User

router = APIRouter()

@router.get("/test", status_code=status.HTTP_200_OK)
def test_meetings_endpoint(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_claims)
):
    """Toplantı modülünün merkezi router bağlantısını test etmek için geçici uç."""
    return {"message": "Meetings router başarıyla bağlandı ve çalışıyor!"}