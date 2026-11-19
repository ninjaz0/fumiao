"""Official chat providers; public descriptors contain no secrets or arbitrary URLs."""
CHAT_MODELS={
    'deepseek-flash':{'label':'DeepSeek Flash','kind':'chat','provider':'deepseek'},
    'gpt-4.1':{'label':'GPT-4.1','kind':'chat','provider':'openai'},
}
PROVIDERS={
    'deepseek':{'label':'DeepSeek','url':'https://api.deepseek.com/chat/completions','models_url':'https://api.deepseek.com/models','env':'DEEPSEEK_API_KEY'},
    'openai':{'label':'OpenAI','url':'https://api.openai.com/v1/chat/completions','models_url':'https://api.openai.com/v1/models','env':'OPENAI_CHAT_API_KEY'},
}
