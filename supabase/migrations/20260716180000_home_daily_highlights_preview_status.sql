-- status preview: черновик перегенерации из настроек CRM (не виден на главной).
-- ready/failed — как раньше. Ночной cron пишет только ready/failed.

ALTER TABLE public.home_daily_highlights
    DROP CONSTRAINT IF EXISTS home_daily_highlights_status_check;

ALTER TABLE public.home_daily_highlights
    ADD CONSTRAINT home_daily_highlights_status_check
    CHECK (status IN ('ready', 'failed', 'preview'));

COMMENT ON COLUMN public.home_daily_highlights.status IS
    'ready | failed | preview (черновик из настроек, на главной не показывается)';
