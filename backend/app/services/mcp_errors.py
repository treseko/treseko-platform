"""Actionable MCP rejection codes without exposing exception payloads."""
from .mcp_limits import McpResultTooLarge
from .mcp_validation import InvalidToolArguments


class McpRevisionConflict(ValueError):
    pass


class McpWebOperationError(ValueError):
    def __init__(self, code: str, *, retryable: bool, next_action: str):
        super().__init__(code)
        self.code = code
        self.retryable = retryable
        self.next_action = next_action


def mcp_web_operation_error(status_code: int) -> McpWebOperationError | None:
    if status_code == 400:
        return McpWebOperationError(
            "WEB_TARGET_REJECTED", retryable=False,
            next_action="Use a public HTTP/HTTPS destination without embedded credentials or private-network addresses.",
        )
    if status_code == 404:
        return McpWebOperationError(
            "WEB_SESSION_UNAVAILABLE", retryable=False,
            next_action="Open a fresh MCP browser session and inspect it before continuing.",
        )
    if status_code == 422:
        return McpWebOperationError(
            "WEB_ACTION_REJECTED", retryable=True,
            next_action="Inspect the page again. Choose an enabled target_id and matching target_name from the latest snapshot, then retry once.",
        )
    if status_code == 502:
        return McpWebOperationError(
            "WEB_TARGET_UNAVAILABLE", retryable=True,
            next_action="Check that the public site is reachable, then retry opening it in a fresh session.",
        )
    return None


def invalid_tool_arguments(request_id, error: InvalidToolArguments):
    return {
        'jsonrpc': '2.0',
        'id': request_id,
        'error': {
            'code': -32602,
            'message': 'Invalid params',
            'data': {
                'code': 'INVALID_TOOL_ARGUMENTS',
                'field': error.field,
                'constraint': error.constraint,
                'retryable': False,
                'next_action': 'Compare the reported field with tools/list inputSchema and correct its required value, type, format or enum.',
            },
        },
    }


def domain_rejection(request_id, error):
    code, action = 'OPERATION_REJECTED', 'Read the current entity and review the native contract before changing arguments.'
    retryable = False
    if isinstance(error, McpWebOperationError):
        code, action, retryable = error.code, error.next_action, error.retryable
    elif isinstance(error, McpRevisionConflict):
        code, action = 'REVISION_CONFLICT', 'Get the entity again, reconcile changes and authorize a new operation.'
    elif isinstance(error, McpResultTooLarge):
        code, action = 'RESULT_TOO_LARGE', 'Reduce the page size or request an individual entity/content chunk.'
    elif isinstance(error, LookupError):
        code, action = 'ENTITY_UNAVAILABLE', 'Resolve the entity in the selected project with authorized listing tools.'
    return {'jsonrpc': '2.0', 'id': request_id, 'error': {'code': -32602, 'message': 'Invalid params', 'data': {'code': code, 'retryable': retryable, 'next_action': action}}}
