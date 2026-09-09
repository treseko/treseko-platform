"""Fixed remote ingress helper. Never takes Docker paths or commands over RPC."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

from .update_durable_ingress import DurableDockerIngressGate
from .update_ingress_rpc import ACTIONS
from .update_participant_commands import load_private_json
from .update_transport import IDENTIFIER


def configuration_identity(config):
    normalized = dict(config)
    normalized.setdefault('callback_drain', False)
    return hashlib.sha256(json.dumps(normalized, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def handle(config, request):
    fields = {'schema', 'id', 'docker', 'container', 'project', 'service', 'control'}
    if (not isinstance(config, dict) or not fields <= set(config) or set(config) - fields - {'callback_drain'}
            or type(config['schema']) is not int
            or config['schema'] != 1 or not all(isinstance(config[k], str) for k in fields - {'schema'})
            or not all(IDENTIFIER.fullmatch(config[k]) for k in ('id', 'project', 'service'))
            or type(config.get('callback_drain', False)) is not bool):
        raise ValueError('Invalid private ingress helper configuration')
    expected = {'schema', 'gate', 'action', 'transaction', 'helper_identity'}
    if (not isinstance(request, dict) or set(request) != expected or type(request['schema']) is not int
            or request['schema'] != 1 or request['gate'] != config['id']
            or not isinstance(request['action'], str) or request['action'] not in ACTIONS
            or not isinstance(request['transaction'], str) or not IDENTIFIER.fullmatch(request['transaction'])
            or request['helper_identity'] != configuration_identity(config)):
        raise ValueError('Ingress request differs from approved host inventory')
    if request['action'] in {'seal', 'assert_sealed'} and not config.get('callback_drain', False):
        raise ValueError('Ingress seal RPC requires callback_drain opt-in')
    gate = DurableDockerIngressGate(config['docker'], config['container'], config['project'],
                                  config['service'], Path(config['control']),
                                  callback_drain=config.get('callback_drain', False))
    getattr(gate, request['action'])(request['transaction'])
    return {**request, 'ok': True}


def main():
    parser = argparse.ArgumentParser(description='Private Treseko ingress RPC helper')
    parser.add_argument('--config', type=Path, default=Path('/etc/treseko/update-ingress.json'))
    args = parser.parse_args()
    try:
        config = load_private_json(args.config)
        raw = sys.stdin.buffer.read(8193)
        if len(raw) > 8192:
            raise ValueError('Ingress request exceeds limit')
        result = handle(config, json.loads(raw))
    except Exception:
        print(json.dumps({'ok': False, 'error': 'ingress_request_failed'}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
