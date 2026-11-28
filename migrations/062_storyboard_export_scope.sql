ALTER TABLE storyboard_exports
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'canvas'
    CHECK (scope IN ('canvas', 'episode'));
