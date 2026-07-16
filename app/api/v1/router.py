# app/api/v1/router.py
from fastapi import APIRouter

# Geliştirdiğimiz modüllerin rotalarını import ediyoruz
from app.routes.auth import router as auth_router
from app.routes.users import router as users_router
from app.routes.meetings import router as meetings_router  # Yeni parça eklendi!
from app.routes.participants import router as participants_router  # Yeni parça eklendi!

# Ana API Router nesnesini oluşturuyoruz
api_router = APIRouter()

# Topladığımız tüm alt rotaları buraya dahil ediyoruz
api_router.include_router(auth_router, prefix="/auth", tags=["Authentication"])
api_router.include_router(users_router, prefix="/users", tags=["Users"])
api_router.include_router(meetings_router, prefix="/meetings", tags=["Toplantılar"]) # Yeni parça bağlandı!
api_router.include_router(participants_router, prefix="/participants", tags=["Toplantı Katılımcıları"])