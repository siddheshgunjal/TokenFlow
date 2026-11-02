-- Track cached prompt tokens separately so TokenFlow can compute cache hit rate.
-- `prompt_tokens` remains the total input context; the cache hit rate is
-- `cached_prompt_tokens / prompt_tokens`, and uncached input is the difference.
ALTER TABLE ollama_logs
    ADD COLUMN cached_prompt_tokens INTEGER NOT NULL DEFAULT 0;
