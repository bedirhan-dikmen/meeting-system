# app/api/v1/router.py
from fastapi import APIRouter

# Geliştirdiğimiz modüllerin rotalarını import ediyoruz
from app.models.auth.routes import router as auth_router
from app.models.users.routes import router as users_router

# Ana API Router nesnesini oluşturuyoruz
api_router = APIRouter()

# Topladığımız tüm alt rotaları buraya dahil ediyoruz
api_router.include_router(auth_router)
api_router.include_router(users_router)