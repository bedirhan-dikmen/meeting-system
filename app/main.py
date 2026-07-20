# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings


from app.api.v1.router import api_router
from app.routes.ui import router as ui_router
# Eğer Alembic kullanmadan önce hızlıca tabloların oluşmasını test etmek istersen (Geliştirme için):
# Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Python & FastAPI, WebRTC, JWT ve REST API Destekli Kurumsal Toplantı Yönetim Sistemi",
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs",  # Swagger UI adresi
    redoc_url="/redoc",  # Alternatif API dokümantasyonu
    swagger_ui_parameters={"persistAuthorization": True} # Token'ın tarayıcı yenilense bile hafızada kalmasını sağlar
)

# Microsoft Teams benzeri web arayüzümüzün (Bootstrap/Frontend) API'mize sorunsuz bağlanabilmesi için CORS Ayarları
origins = [
    "http://localhost", 
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    # Canlı ortamdaki frontend adresi buraya eklenecektir
]
# 1. Statik Dosyalar ve Şablonların Bağlanması
app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Rotaların Öncelik Sırasına Göre Eklenmesi (UI her zaman çakışmaları önlemek için temiz ayrılmalıdır)
app.include_router(ui_router) # Arayüz render rotası
app.include_router(api_router, prefix=settings.API_V1_STR)

# Temel Sağlık Kontrolü (Health Check) Endpoint'i
@app.get("/api/v1/status")
def get_system_status():
    return {
        "status": "active",
        "project": settings.PROJECT_NAME,
        "version": "1.0.0",
        "docs": "/docs"
    }