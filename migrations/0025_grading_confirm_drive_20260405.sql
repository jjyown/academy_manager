-- Grading confirm + Drive: run in Supabase SQL Editor only (not Python/HTML)
-- Adds columns for deferred Drive upload on teacher confirm

ALTER TABLE grading_items ADD COLUMN IF NOT EXISTS source_image_index INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN grading_items.source_image_index IS 'ZIP page index (0-based). Used when building graded images on confirm.';

ALTER TABLE grading_results ADD COLUMN IF NOT EXISTS drive_publish_folder TEXT;
ALTER TABLE grading_results ADD COLUMN IF NOT EXISTS drive_publish_sub_path JSONB;

COMMENT ON COLUMN grading_results.drive_publish_folder IS 'Drive top folder name for graded images (e.g. graded results folder).';
COMMENT ON COLUMN grading_results.drive_publish_sub_path IS 'JSON array: year/month/day/student path segments.';
