from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

@router.get("/preview/{meeting_code}", response_class=HTMLResponse)
def get_meeting_preview(request: Request, meeting_code: str):
    """Kullanıcının odaya girmeden önce kamera/mikrofon test ettiği lobi sayfası."""
    return templates.TemplateResponse("preview.html", {"request": request, "meeting_code": meeting_code})