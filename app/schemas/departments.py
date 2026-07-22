from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class DepartmentBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    # description alanında herhangi bir kısıtlama veya id uyarısı vermiyoruz, direkt getir diyoruz.
    description: Optional[str] = Field(None)

class DepartmentCreate(DepartmentBase):
    pass

class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class DepartmentOut(DepartmentBase):
    id: int  # Çıktı kimliği artık int!
    created_at: datetime

    class Config:
        from_attributes = True