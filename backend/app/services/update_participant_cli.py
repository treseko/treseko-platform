"""Fixed SSH helper entry point; reads one bounded JSON request from stdin.

Install outside application containers with a private, operator-owned config.
The bootstrap installer and Docker/systemd driver configuration are separate.
"""
import argparse
import json
from pathlib import Path
import sys

from .update_participant import LocalUpdateParticipant
from .update_participant_commands import CommandRuntime, load_private_config, load_private_json
from .update_transport import IDENTIFIER
from .update_artifact_transfer import read_header, receive_artifact, validate_header
from .update_docker_driver import DockerCommandRuntime


def select_config(request, config):
    if "participants" in config:
        if (set(config) != {"schema", "participants"} or config["schema"] != 1
                or not isinstance(config["participants"], dict)
                or not isinstance(request, dict) or not isinstance(request.get("participant"), str)
                or not IDENTIFIER.fullmatch(request["participant"])):
            raise ValueError("Invalid host participant routing configuration")
        selected = config["participants"].get(request["participant"])
        if not isinstance(selected, str) or not Path(selected).is_absolute():
            raise ValueError("Participant is not authorized on this host")
        # RPC supplies only an ID; paths/commands come from the private host
        # allowlist. Each component keeps its own original version and journal.
        config = load_private_config(Path(selected))
    if not isinstance(request, dict) or request.get("participant") != config.get("participant"):
        raise ValueError("Participant is not authorized on this host")
    return config


def handle(request, config):
    config = select_config(request, config)
    if (not isinstance(request, dict) or request.get("schema") != 1
            or request.get("participant") != config["participant"]
            or set(request) != {"schema", "participant", "operation", "transaction", "release"}
            or not isinstance(request["release"], dict)):
        raise ValueError("Invalid participant RPC envelope")
    if "runtime" in config:
        if "commands" in config:
            raise ValueError("Choose one private runtime configuration")
        runtime = DockerCommandRuntime(config["runtime"], config.get("timeout_seconds", 2100))
    else:
        runtime = CommandRuntime(config["commands"], config.get("timeout_seconds", 300))
    participant = LocalUpdateParticipant(config["participant"], Path(config["directory"]),
                                         Path(config["cache"]), runtime)
    result = participant.execute(request["operation"], request["transaction"], request["release"])
    return {**result, "schema": 1, "participant": config["participant"],
            "operation": request["operation"], "transaction": request["transaction"]}


def main():
    parser = argparse.ArgumentParser(description="Treseko private update participant RPC")
    parser.add_argument("--config", type=Path, default=Path("/etc/treseko/update-participant.json"))
    parser.add_argument("--receive", action="store_true", help="Receive a signed header and binary artifact on stdin")
    args = parser.parse_args()
    try:
        config = load_private_json(args.config)
        if "participants" not in config:
            config = load_private_config(args.config)
        if args.receive:
            request = read_header(sys.stdin.buffer)
            validate_header(request)
            selected = select_config(request, config)
            result = receive_artifact(sys.stdin.buffer, request, Path(selected["cache"]))
        else:
            raw = sys.stdin.buffer.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise ValueError("Participant request exceeds limit")
            result = handle(json.loads(raw), config)
    except Exception:
        # Do not echo arbitrary requests or driver diagnostics (may contain secrets).
        print(json.dumps({"ok": False, "error": "participant_request_failed"}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
