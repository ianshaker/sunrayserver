-- =============================================================================
-- Факты дня: второй столбец — язвительный/фирменный коммент нейробота
-- Один запрос к Gemini → situation (text) + bot_comment
-- =============================================================================

ALTER TABLE public.home_daily_highlights
  ADD COLUMN IF NOT EXISTS bot_comment text;

COMMENT ON COLUMN public.home_daily_highlights.text IS
  'Ситуация из звонка (1–2 предложения), обезличенно';
COMMENT ON COLUMN public.home_daily_highlights.bot_comment IS
  'Короткий фирменный/язвительный комментарий нейробота к ситуации (может быть NULL у старых строк)';
