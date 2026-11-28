-- Bind each billable director item to the checked inputs and original price.
ALTER TABLE canvas_precheck_tickets ADD COLUMN IF NOT EXISTS director_items jsonb;
