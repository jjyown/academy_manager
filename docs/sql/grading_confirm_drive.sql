-- Same as SUPABASE_GRADING_CONFIRM_DRIVE_20260405.sql (shorter path for editor issues)
-- Run in Supabase SQL Editor -> Primary database

ALTER TABLE grading_items ADD COLUMN IF NOT EXISTS source_image_index INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN grading_items.source_image_index IS 'ZIP page index (0-based). Used when building graded images on confirm.';

ALTER TABLE grading_results ADD COLUMN IF NOT EXISTS drive_publish_folder TEXT;
ALTER TABLE grading_results ADD COLUMN IF NOT EXISTS drive_publish_sub_path JSONB;

COMMENT ON COLUMN grading_results.drive_publish_folder IS 'Drive top folder name for graded images.';
COMMENT ON COLUMN grading_results.drive_publish_sub_path IS 'JSON array: path segments under top folder.';
