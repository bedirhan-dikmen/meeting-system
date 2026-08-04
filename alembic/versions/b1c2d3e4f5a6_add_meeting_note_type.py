"""add_meeting_note_type

Revision ID: b1c2d3e4f5a6
Revises: 9a8b7c6d5e4f
Create Date: 2026-08-04 20:00:00.000000

Not: MeetingNote.note_type alani modele (app/models/meeting_note.py) daha
onceki bir commit'te eklenmis ama hicbir migration'a dahil edilmemisti.
Var olan bir 'meetings_notes' kaydi bulunan ortamlarda (Postgres/production
dahil) bu sutun eksik oldugu icin toplanti guncelleme/iptal islemleri
(SQLAlchemy'nin notes iliskisini cascade="all, delete-orphan" nedeniyle
flush oncesi sorgulamasi) 500 hatasiyla patliyordu.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, Sequence[str], None] = '9a8b7c6d5e4f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'meeting_notes',
        sa.Column('note_type', sa.String(length=20), server_default='general', nullable=False)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('meeting_notes', 'note_type')
