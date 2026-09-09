"""Private ingress inventory; no endpoints or commands accepted from releases."""
from .update_docker_ingress import DockerIngressGate
from .update_transport import IDENTIFIER
from pathlib import Path
from .update_durable_ingress import DurableDockerIngressGate
from .update_ingress_rpc import ProcessIngressGate


def configured_gates(nodes, *, legacy_gate_factory=None):
    if not isinstance(nodes, list):
        raise ValueError('Admission gates must be an explicit inventory list')
    gates, bindings, targets = {}, [], set()
    base_fields = {'id', 'kind', 'docker', 'container', 'project', 'service'}
    for node in nodes:
        if isinstance(node, dict) and node.get('kind') == 'legacy':
            if set(node) != {'id', 'kind', 'scope'} or not IDENTIFIER.fullmatch(node.get('id', '')) \
                    or not isinstance(node.get('scope'), str) or not node['scope']:
                raise ValueError('Invalid legacy admission gate inventory')
            if not callable(legacy_gate_factory):
                raise ValueError('Legacy admission gate requires injected fence and control adapters')
            result = legacy_gate_factory(dict(node))
            if (not isinstance(result, tuple) or len(result) != 2
                    or not hasattr(result[0], 'acquire') or not hasattr(result[0], 'assert_closed')
                    or not hasattr(result[0], 'release') or not isinstance(result[1], dict)):
                raise ValueError('Legacy admission gate factory returned an invalid adapter')
            gate, binding = result
            if node['id'] in gates or node['id'] in targets:
                raise ValueError('Admission gate IDs must be unique')
            gates[node['id']] = gate
            bindings.append({**node, **binding})
            continue
        if isinstance(node, dict) and node.get('kind') == 'ai-queue-local':
            # Loading the AI gate itself is deferred until an AI gate is
            # explicitly inventoried.  Importing the operator controller or
            # planning a configuration without this gate must not initialize
            # the application database.
            from .update_ai_queue_gate import AIQueueLocalGate

            required = {'id', 'kind', 'database_url_file', 'database_name',
                        'timeout_seconds', 'journal_directory'}
            if (set(node) != required or not isinstance(node.get('id'), str)
                    or not IDENTIFIER.fullmatch(node.get('id', ''))
                    or not all(isinstance(node[key], str)
                               for key in required - {'timeout_seconds'})
                    or node['id'] in gates):
                raise ValueError('Invalid AI queue gate inventory')
            target = ('ai-queue-local', node['database_url_file'], node['database_name'],
                      node['journal_directory'])
            if target in targets:
                raise ValueError('An AI queue target cannot appear twice')
            config = {key: node[key] for key in required - {'id', 'kind'}}
            gate = AIQueueLocalGate(config)
            targets.add(target)
            gates[node['id']] = gate
            bindings.append({**node, 'identity': gate.identity})
            continue
        if isinstance(node, dict) and node.get('kind') == 'ssh':
            required = {'id', 'kind', 'alias', 'helper_identity'}
            if (not required <= set(node) or set(node) - required - {'timeout_seconds', 'callback_drain'}
                    or not all(isinstance(node[k], str) for k in required)
                    or type(node.get('callback_drain', False)) is not bool
                    or node['id'] in gates):
                raise ValueError('Invalid ingress SSH inventory')
            target = ('ssh', node['alias'], node['helper_identity'])
            if target in targets:
                raise ValueError('An ingress target cannot appear twice')
            gate, resolved = ProcessIngressGate.ssh(node['id'], node['alias'], node['helper_identity'],
                                                  node.get('timeout_seconds', 120),
                                                  node.get('callback_drain', False))
            targets.add(target)
            gates[node['id']] = gate
            bindings.append({**node, **resolved})
            continue
        fields = base_fields | ({'control'} if isinstance(node, dict) and node.get('kind') == 'docker-host-bind' else set())
        if (not isinstance(node, dict) or set(node) - fields - {'callback_drain'}
                or not all(isinstance(value, str) and value for key, value in node.items()
                           if key != 'callback_drain')
                or type(node.get('callback_drain', False)) is not bool
                or node['kind'] not in {'docker-local', 'docker-host-bind'} or not IDENTIFIER.fullmatch(node['id'])
                or node['id'] in gates or not IDENTIFIER.fullmatch(node['project'])
                or not IDENTIFIER.fullmatch(node['service'])
                or (node.get('callback_drain', False) and node['kind'] != 'docker-host-bind')):
            raise ValueError('Invalid or unsupported admission gate inventory')
        target = (node['docker'], node['container'])
        if target in targets:
            raise ValueError('An ingress target cannot appear twice')
        targets.add(target)
        args = (node['docker'], node['container'], node['project'], node['service'])
        gates[node['id']] = (DurableDockerIngressGate(*args, Path(node['control']),
                                                       callback_drain=node.get('callback_drain', False))
                             if node['kind'] == 'docker-host-bind' else DockerIngressGate(*args))
        bindings.append(dict(node))
    return gates, bindings
