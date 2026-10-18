# Local trusted bootstrap image. BASE_IMAGE is a deliberate, reviewable tag;
# the resolved image ID is recorded by the operator after each local build.
ARG BASE_IMAGE=python:3.12-slim-bookworm
ARG COMPOSE_IMAGE=docker/compose-bin:v5.4.0
FROM ${COMPOSE_IMAGE} AS compose
FROM ${BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt/treseko/backend

# Docker and SSH are invoked by configured helpers. They are Linux packages,
# never binaries copied from the macOS operator host.
RUN apt-get update \
    && apt-get install -y --no-install-recommends docker.io openssh-client \
    && rm -rf /var/lib/apt/lists/*
COPY --from=compose /docker-compose /usr/libexec/docker/cli-plugins/docker-compose
RUN chmod 0755 /usr/libexec/docker/cli-plugins/docker-compose \
    && python -m pip install --no-cache-dir cryptography SQLAlchemy asyncpg

RUN mkdir -p /opt/treseko/backend/app/services/edition
COPY backend/app/version.py /opt/treseko/backend/app/version.py
COPY backend/app/services/__init__.py /opt/treseko/backend/app/services/__init__.py
COPY backend/app/services/edition/update_manager.py /opt/treseko/backend/app/services/edition/update_manager.py
COPY backend/app/services/update_ai_queue_control.py backend/app/services/update_ai_queue_gate.py backend/app/services/update_ai_queue_guard.py backend/app/services/update_artifact_transfer.py backend/app/services/update_backend_control.py backend/app/services/update_component_probe.py backend/app/services/update_controller_cli.py backend/app/services/update_docker_build.py backend/app/services/update_docker_component.py backend/app/services/update_docker_driver.py backend/app/services/update_docker_ingress.py backend/app/services/update_docker_migrator.py backend/app/services/update_docker_mutable.py backend/app/services/update_docker_postgres.py backend/app/services/update_docker_postgres_participant.py backend/app/services/update_docker_runtime.py backend/app/services/update_docker_service.py backend/app/services/update_durable_ingress.py backend/app/services/update_engine_control.py backend/app/services/update_existing_installation.py backend/app/services/update_existing_installation_errors.py backend/app/services/update_complete_source.py backend/app/services/update_existing_installation_docker_preflight.py backend/app/services/update_gate_inventory.py backend/app/services/update_helper_installation.py backend/app/services/update_helper_complete_source.py backend/app/services/update_helper_installation_launcher.py backend/app/services/update_helper_installation_state.py backend/app/services/update_host_bridge.py backend/app/services/update_host_bridge_cli.py backend/app/services/update_host_bridge_client.py backend/app/services/update_host_bridge_spool.py backend/app/services/update_ingress_cli.py backend/app/services/update_ingress_rpc.py backend/app/services/update_installation_topology.py backend/app/services/update_journal.py backend/app/services/update_migrator_identity.py backend/app/services/update_participant.py backend/app/services/update_participant_cli.py backend/app/services/update_participant_commands.py backend/app/services/update_participant_package.py backend/app/services/update_postgres_driver.py backend/app/services/update_postgres_probe.py backend/app/services/update_prepared_migrator.py backend/app/services/update_recovery_archive.py backend/app/services/update_recovery_capture.py backend/app/services/update_recovery_loader.py backend/app/services/update_recovery_pipeline.py backend/app/services/update_runtime_host_inventory.py backend/app/services/update_runtime_preparation.py backend/app/services/update_runtime_preparation_cli.py backend/app/services/update_runtime_preparation_rpc.py backend/app/services/update_shared_runtime.py backend/app/services/update_transaction.py backend/app/services/update_transport.py backend/app/services/update_worker_control.py backend/app/services/update_worker_drain.py /opt/treseko/backend/app/services/

# Validate only trusted image source during build; incoming update archives are
# inspected and signature-checked later by HelperInstallation.
RUN python -c "import importlib; [importlib.import_module(name) for name in ('app.services.update_participant_cli', 'app.services.update_ingress_cli', 'app.services.update_runtime_preparation_cli', 'app.services.update_host_bridge_cli', 'app.services.update_complete_source', 'app.services.update_helper_complete_source')]"

ENTRYPOINT ["/usr/local/bin/python"]
