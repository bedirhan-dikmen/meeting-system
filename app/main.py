# app/main.py
import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from app.core.config import settings
from app.core.database import engine, Base
from app.api.v1.router import api_router

# Tabloların oluşmasını geliştirme aşamasında otomatik tetikle
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Python & FastAPI, WebRTC, JWT ve REST API Destekli Kurumsal Toplantı Yönetim Sistemi",
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs",  # Swagger UI adresi
    redoc_url="/redoc",  # Alternatif API dokümantasyonu
    swagger_ui_parameters={"persistAuthorization": True} # Token'ın tarayıcı yenilense bile hafızada kalmasını sağlar
)

# Static & Templates dizin yolları
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

# Dizinler yoksa otomatik oluştur
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "css"), exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "js"), exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# CORS Ayarları
origins = [
    "http://localhost", 
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:3000",
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)

# --- FRONTEND HTML SAYFA ROTALARI ---
@app.get("/login", tags=["Frontend Sayfaları"])
def page_login(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})

@app.get("/", tags=["Frontend Sayfaları"])
def page_dashboard(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/meetings", tags=["Frontend Sayfaları"])
def page_meetings(request: Request):
    return templates.TemplateResponse("meetings.html", {"request": request})

@app.get("/prejoin/{meeting_code}", tags=["Frontend Sayfaları"])
def page_prejoin(request: Request, meeting_code: str):
    from app.core.database import SessionLocal
    from app.models.meeting import Meeting
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.meeting_code == meeting_code).first()
    db.close()
    if meeting and meeting.status == "tamamlandı":
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=f"/reports/{meeting.id}")
    return templates.TemplateResponse("prejoin.html", {"request": request, "meeting_code": meeting_code})

@app.get("/room/{meeting_code}", tags=["Frontend Sayfaları"])
def page_room(request: Request, meeting_code: str):
    from app.core.database import SessionLocal
    from app.models.meeting import Meeting
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.meeting_code == meeting_code).first()
    db.close()
    if meeting and meeting.status == "tamamlandı":
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=f"/reports/{meeting.id}")
    return templates.TemplateResponse("room.html", {"request": request, "meeting_code": meeting_code})


@app.get("/reports/{meeting_id}", tags=["Frontend Sayfaları"])
def page_report(request: Request, meeting_id: str):
    return templates.TemplateResponse("report.html", {"request": request, "meeting_id": meeting_id})

@app.get("/profile", tags=["Frontend Sayfaları"])
def page_profile(request: Request):
    return templates.TemplateResponse("profile.html", {"request": request})

@app.get("/api-status", tags=["Health Check"])
def read_root():
    return {
        "status": "active",
        "project": settings.PROJECT_NAME,
        "version": "1.0.0",
        "docs": "/docs"
    }