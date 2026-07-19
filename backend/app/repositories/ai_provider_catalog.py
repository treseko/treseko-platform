AI_PROVIDER_KEY_ENV = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "google": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "together": "TOGETHER_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "cohere": "COHERE_API_KEY",
    "fireworks": "FIREWORKS_API_KEY",
    "perplexity": "PERPLEXITY_API_KEY",
    "xai": "XAI_API_KEY",
    "azure-openai": "AZURE_OPENAI_API_KEY",
}

AI_PROVIDER_NO_KEY = {"lm-studio", "ollama", "openai-compatible", "custom-http"}

AI_PROVIDER_PRESET_MODELS = {
    "openai": [
        {"id": "gpt-4.1", "name": "gpt-4.1", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1047576, "notes": "Preset OpenAI general."}},
        {"id": "gpt-4.1-mini", "name": "gpt-4.1-mini", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1047576, "notes": "Preset OpenAI rapido."}},
        {"id": "gpt-4o", "name": "gpt-4o", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset OpenAI multimodal."}},
        {"id": "gpt-4o-mini", "name": "gpt-4o-mini", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset OpenAI rapido y economico."}},
    ],
    "gemini": [
        {"id": "gemini-2.5-pro", "name": "gemini-2.5-pro", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1000000, "notes": "Preset Google Gemini Pro."}},
        {"id": "gemini-2.5-flash", "name": "gemini-2.5-flash", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1000000, "notes": "Preset Google Gemini Flash."}},
        {"id": "gemini-2.0-flash", "name": "gemini-2.0-flash", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1000000, "notes": "Preset Google Gemini rapido."}},
    ],
    "google": [
        {"id": "gemini-2.5-pro", "name": "gemini-2.5-pro", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1000000, "notes": "Preset Google Gemini Pro."}},
        {"id": "gemini-2.5-flash", "name": "gemini-2.5-flash", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1000000, "notes": "Preset Google Gemini Flash."}},
        {"id": "gemini-2.0-flash", "name": "gemini-2.0-flash", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1000000, "notes": "Preset Google Gemini rapido."}},
    ],
    "anthropic": [
        {"id": "claude-sonnet-4", "name": "claude-sonnet-4", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": False, "context_window": 200000, "notes": "Preset Anthropic Sonnet."}},
        {"id": "claude-opus-4", "name": "claude-opus-4", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": False, "context_window": 200000, "notes": "Preset Anthropic Opus."}},
        {"id": "claude-3-5-sonnet-latest", "name": "claude-3-5-sonnet-latest", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": False, "context_window": 200000, "notes": "Preset Anthropic Sonnet estable."}},
        {"id": "claude-3-5-haiku-latest", "name": "claude-3-5-haiku-latest", "capabilities": {"vision": True, "reasoning": False, "tools": True, "json_mode": False, "context_window": 200000, "notes": "Preset Anthropic Haiku rapido."}},
    ],
    "groq": [
        {"id": "llama-3.3-70b-versatile", "name": "llama-3.3-70b-versatile", "capabilities": {"vision": False, "reasoning": False, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset Groq OpenAI-compatible."}},
        {"id": "deepseek-r1-distill-llama-70b", "name": "deepseek-r1-distill-llama-70b", "capabilities": {"vision": False, "reasoning": True, "tools": False, "json_mode": True, "context_window": 128000, "notes": "Preset Groq razonamiento."}},
    ],
    "deepseek": [
        {"id": "deepseek-chat", "name": "deepseek-chat", "capabilities": {"vision": False, "reasoning": False, "tools": True, "json_mode": True, "context_window": 64000, "notes": "Preset DeepSeek chat."}},
        {"id": "deepseek-reasoner", "name": "deepseek-reasoner", "capabilities": {"vision": False, "reasoning": True, "tools": False, "json_mode": True, "context_window": 64000, "notes": "Preset DeepSeek razonamiento."}},
    ],
    "openrouter": [
        {"id": "openai/gpt-4o-mini", "name": "OpenAI GPT-4o mini", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset OpenRouter."}},
        {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": False, "context_window": 200000, "notes": "Preset OpenRouter."}},
        {"id": "google/gemini-2.0-flash-001", "name": "Gemini 2.0 Flash", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1000000, "notes": "Preset OpenRouter."}},
    ],
    "together": [
        {"id": "meta-llama/Llama-3.3-70B-Instruct-Turbo", "name": "Llama 3.3 70B Instruct Turbo", "capabilities": {"vision": False, "reasoning": False, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset Together AI."}},
        {"id": "Qwen/Qwen2.5-72B-Instruct-Turbo", "name": "Qwen2.5 72B Instruct Turbo", "capabilities": {"vision": False, "reasoning": False, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset Together AI."}},
    ],
    "mistral": [
        {"id": "mistral-large-latest", "name": "mistral-large-latest", "capabilities": {"vision": False, "reasoning": True, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset Mistral."}},
        {"id": "mistral-small-latest", "name": "mistral-small-latest", "capabilities": {"vision": False, "reasoning": False, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset Mistral rapido."}},
    ],
    "cohere": [
        {"id": "command-r-plus-08-2024", "name": "command-r-plus-08-2024", "capabilities": {"vision": False, "reasoning": False, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset Cohere."}},
        {"id": "command-r-08-2024", "name": "command-r-08-2024", "capabilities": {"vision": False, "reasoning": False, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset Cohere rapido."}},
    ],
    "fireworks": [
        {"id": "accounts/fireworks/models/llama-v3p1-8b-instruct", "name": "Llama 3.1 8B Instruct", "capabilities": {"vision": False, "reasoning": False, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset Fireworks."}},
        {"id": "accounts/fireworks/models/llama-v3p1-70b-instruct", "name": "Llama 3.1 70B Instruct", "capabilities": {"vision": False, "reasoning": False, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset Fireworks."}},
    ],
    "perplexity": [
        {"id": "sonar-pro", "name": "sonar-pro", "capabilities": {"vision": False, "reasoning": False, "tools": False, "json_mode": True, "context_window": 128000, "notes": "Preset Perplexity."}},
        {"id": "sonar", "name": "sonar", "capabilities": {"vision": False, "reasoning": False, "tools": False, "json_mode": True, "context_window": 128000, "notes": "Preset Perplexity rapido."}},
    ],
    "xai": [
        {"id": "grok-3", "name": "grok-3", "capabilities": {"vision": False, "reasoning": True, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset xAI."}},
        {"id": "grok-3-mini", "name": "grok-3-mini", "capabilities": {"vision": False, "reasoning": True, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset xAI rapido."}},
    ],
    "azure-openai": [
        {"id": "gpt-4o", "name": "gpt-4o deployment", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset Azure OpenAI. El ID debe coincidir con el deployment configurado."}},
        {"id": "gpt-4o-mini", "name": "gpt-4o-mini deployment", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 128000, "notes": "Preset Azure OpenAI. El ID debe coincidir con el deployment configurado."}},
    ],
}
