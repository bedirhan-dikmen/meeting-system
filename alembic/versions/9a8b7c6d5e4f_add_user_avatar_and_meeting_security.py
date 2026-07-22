"""add_user_avatar_and_meeting_security

Revision ID: 9a8b7c6d5e4f
Revises: 3e0662bd2725
Create Date: 2026-07-22 09:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9a8b7c6d5e4f'
down_revision: Union[str, Sequence[str], None] = '3e0662bd2725'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add avatar_url to users table
    op.add_column('users', sa.Column('avatar_url', sa.String(), nullable=True))
    
    # Add passcode, lobby_enabled, is_private to meetings table
    op.add_column('meetings', sa.Column('passcode', sa.String(length=50), nullable=True))
    op.add_column('meetings', sa.Column('lobby_enabled', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('meetings', sa.Column('is_private', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('meetings', 'is_private')
    op.drop_column('meetings', 'lobby_enabled')
    op.drop_column('meetings', 'passcode')
    op.drop_column('users', 'avatar_url')
