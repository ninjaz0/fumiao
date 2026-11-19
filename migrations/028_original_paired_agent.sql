-- An original ticket survives one lease expiry so the same worker may resume
-- before a new claim replaces it. The executor's internal lease stays UUID.
ALTER TABLE jobs ADD COLUMN original_gpu_ticket text;
CREATE UNIQUE INDEX jobs_original_gpu_ticket ON jobs(original_gpu_ticket) WHERE original_gpu_ticket IS NOT NULL;
