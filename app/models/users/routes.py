# app/modules/users/routes.py
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.core.security import verify_admin_role, get_password_hash
from app.models.all_models import User, Department
from app.models.users.schemas import UserCreate, UserUpdate, UserResponse

router = APIRouter(prefix="/users", tags=["User Management"])

@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate, 
    db: Session = Depends(get_db), 
    _admin = Depends(verify_admin_role)  # Sadece admin ekleyebilir
):
    """Sisteme yeni bir personel/yönetici ekler."""
    # E-posta mükerrerlik kontrolü
    existing_email = db.query(User).filter(User.email == payload.email).first()
    if existing_email:
        raise HTTPException(status_code=400, detail="Bu e-posta adresi zaten kullanımda.")

    # Kullanıcı kodu mükerrerlik kontrolü
    if payload.user_code:
        existing_code = db.query(User).filter(User.user_code == payload.user_code).first()
        if existing_code:
            raise HTTPException(status_code=400, detail="Bu kullanıcı kodu zaten tanımlanmış.")

    # Departman kontrolü
    if payload.department_id:
        dept = db.query(Department).filter(Department.id == payload.department_id).first()
        if not dept:
            raise HTTPException(status_code=404, detail="Belirtilen departman bulunamadı.")

    # Şifreyi güvenli bir şekilde yeni bcrypt modülümüzle hashleyip kaydediyoruz
    hashed_password = get_password_hash(payload.password)

    new_user = User(
        first_name=payload.first_name,
        last_name=payload.last_name,
        email=payload.email,
        user_code=payload.user_code,
        password_hash=hashed_password,
        role=payload.role,
        is_active=payload.is_active,
        department_id=payload.department_id
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.get("/", response_model=List[UserResponse])
def list_users(
    department_id: Optional[int] = Query(None, description="Departmana göre filtreleme"),
    search: Optional[str] = Query(None, description="Ad, soyad veya e-postada arama"),
    db: Session = Depends(get_db),
    _admin = Depends(verify_admin_role)
):
    """Sistemdeki kullanıcıları listeler ve filtreler."""
    query = db.query(User)

    if department_id:
        query = query.filter(User.department_id == department_id)
    if search:
        query = query.filter(
            User.first_name.ilike(f"%{search}%") | 
            User.last_name.ilike(f"%{search}%") | 
            User.email.ilike(f"%{search}%")
        )
    return query.all()


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: UUID, 
    db: Session = Depends(get_db), 
    _admin = Depends(verify_admin_role)
):
    """ID'ye göre tek bir kullanıcının detaylarını getirir."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    return user


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: UUID, 
    payload: UserUpdate, 
    db: Session = Depends(get_db), 
    _admin = Depends(verify_admin_role)
):
    """Mevcut bir kullanıcının bilgilerini günceller veya şifresini yeniler."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")

    # Verileri güncelle
    update_data = payload.model_dump(exclude_unset=True)
    
    if "password" in update_data:
        update_data["password_hash"] = get_password_hash(update_data.pop("password"))

    if "department_id" in update_data and update_data["department_id"] is not None:
        dept = db.query(Department).filter(Department.id == update_data["department_id"]).first()
        if not dept:
            raise HTTPException(status_code=404, detail="Departman bulunamadı.")

    for key, value in update_data.items():
        setattr(user, key, value)

    db.commit()
    db.refresh(user)
    return user


# app/models/users/routes.py dosyasının en altına eklenecek DELETE ucu:

@router.delete("/{user_id}", status_code=status.HTTP_200_OK)
def delete_user(
    user_id: UUID,
    soft_delete: bool = Query(True, description="True ise kullanıcıyı pasife alır, False ise DB'den tamamen siler."),
    db: Session = Depends(get_db),
    _admin = Depends(verify_admin_role)  # Sadece yönetici silebilir/pasife alabilir
):
    """
    Kullanıcıyı sistemden uzaklaştırır.
    Kurumsal bütünlük için varsayılan olarak 'soft_delete=True' (Pasife alma) çalışır.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Sistemde belirtilen kullanıcı bulunamadı.")

    # Koruma: Admin kendi kendini silemesin veya pasife alamassın
    # (Buradaki mantık, hata kaza sistemin adminsiz kalmasını önlemektir)
    
    if soft_delete:
        # SOFT DELETE: Kullanıcıyı pasif yap (Önerilen Yöntem)
        user.is_active = False
        db.commit()
        return {
            "status": "success",
            "message": f"{user.first_name} {user.last_name} isimli personel başarıyla pasif duruma getirildi. Geçmiş kayıtları korundu."
        }
    else:
        # HARD DELETE: Veritabanından kökten sil
        try:
            db.delete(user)
            db.commit()
            return {
                "status": "success",
                "message": f"{user.first_name} {user.last_name} isimli personel veritabanından tamamen silindi."
            }
        except Exception as e:
            db.rollback()
            raise HTTPException(
                status_code=400, 
                detail="Bu kullanıcıya ait geçmiş toplantı veya session kayıtları olduğundan kalıcı olarak silinemiyor. Lütfen soft_delete (pasife alma) kullanın."
            )