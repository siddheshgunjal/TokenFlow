-- Upstream-reported or stream-derived inference timings.
-- Durations are nanoseconds.
ALTER TABLE ollama_logs ADD COLUMN prompt_eval_duration_ns INTEGER;
ALTER TABLE ollama_logs ADD COLUMN eval_duration_ns INTEGER;

-- 'native'    = reported by Ollama
-- 'estimated' = derived from /v1 stream timing
-- NULL        = no timing data
ALTER TABLE ollama_logs ADD COLUMN timing_source TEXT;

CREATE INDEX IF NOT EXISTS idx_ollama_logs_model_created_at
    ON ollama_logs (model, created_at);
