"""Disable extension instances with an inconsistent tenant scope.

Revision ID: 20260831_0060
Revises: 20260826_0059
"""

from alembic import op
import sqlalchemy as sa


revision = "20260831_0060"
down_revision = "20260826_0059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        UPDATE integration_instances
        SET enabled = FALSE,
            status = 'scope_invalid',
            last_error = 'El alcance persistido es inconsistente y requiere correccion administrativa'
        WHERE NOT (
            (scope_key = 'global' AND organizacion_id IS NULL AND proyecto_id IS NULL)
            OR
            (
                proyecto_id IS NOT NULL
                AND scope_key = 'project:' || CAST(proyecto_id AS TEXT)
                AND EXISTS (
                    SELECT 1
                    FROM proyectos
                    WHERE proyectos.id = integration_instances.proyecto_id
                      AND (
                          integration_instances.organizacion_id IS NULL
                          OR integration_instances.organizacion_id = proyectos.organizacion_id
                      )
                )
            )
            OR
            (
                proyecto_id IS NULL
                AND organizacion_id IS NOT NULL
                AND scope_key = 'organization:' || CAST(organizacion_id AS TEXT)
                AND EXISTS (SELECT 1 FROM organizaciones WHERE organizaciones.id = integration_instances.organizacion_id)
            )
        )
    """))


def downgrade() -> None:
    # The previous enabled state cannot be reconstructed safely. Keeping these
    # rows disabled is the only reversible, fail-closed behavior.
    pass
