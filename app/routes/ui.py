from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

router = APIRouter(tags=["UI Engine"])
templates = Jinja2Templates(directory="app/templates")

@router.get("/", response_class=HTMLResponse)
def get_login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})

# BAŞINA / EKLEDİK
@router.get("/dashboard", response_class=HTMLResponse)
def get_dashboard_page(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})

# BAŞINA / EKLEDİK
@router.get("/room/{meeting_code}", response_class=HTMLResponse)
def get_room_page(request: Request, meeting_code: str):
    return templates.TemplateResponse("room.html", {"request": request, "meeting_code": meeting_code})

# BAŞINA / EKLEDİK
@router.get("/report/{meeting_id}", response_class=HTMLResponse)
def get_report_page(request: Request, meeting_id: str):
    return templates.TemplateResponse("report.html", {"request": request, "meeting_id": meeting_id})