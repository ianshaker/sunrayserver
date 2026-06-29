-- Telegram-личность сотрудников прямо в profiles — единый источник правды
-- для уведомлений (chat_id) и проверки прав на кнопки (user_id).
--
-- telegram_user_id  — стабильный числовой id, главный ключ проверки прав.
--                     Заполняется автоматически при первом нажатии кнопки
--                     (по совпадению ника), дальше всё держится на нём.
-- telegram_username — ник без @, в нижнем регистре. Только для первичной привязки.
-- telegram_chat_id  — личный чат сотрудника с ботом (куда слать уведомления).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS telegram_username TEXT,
  ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_telegram_user_id_key
  ON public.profiles (telegram_user_id)
  WHERE telegram_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_telegram_username_key
  ON public.profiles (telegram_username)
  WHERE telegram_username IS NOT NULL;

COMMENT ON COLUMN public.profiles.telegram_user_id IS
  'Стабильный Telegram user id. Главный ключ проверки прав на кнопки. Заполняется при первом нажатии.';
COMMENT ON COLUMN public.profiles.telegram_username IS
  'Ник Telegram без @, в нижнем регистре. Для первичной привязки user_id.';
COMMENT ON COLUMN public.profiles.telegram_chat_id IS
  'Личный чат сотрудника с ботом (куда слать уведомления о задачах).';

-- --- Ники (первичная привязка, по данным пользователя) ---
UPDATE public.profiles SET telegram_username = 'gvmironov'
  WHERE id = 'f687a6de-9da9-48e4-ae0d-0460bd03edf3'; -- Глеб Миронов
UPDATE public.profiles SET telegram_username = 'bravekate19'
  WHERE id = '5572d59d-960d-43f1-b805-b60e42c2752c'; -- Челтуиторь Екатерина
UPDATE public.profiles SET telegram_username = 'albalyxs'
  WHERE id = 'c29869e0-473f-4a3e-a517-687a1a1c0e42'; -- Александра Балукова
UPDATE public.profiles SET telegram_username = 'elenamira70'
  WHERE id = '6f816db9-70f3-463f-b01b-66a1825e505c'; -- Елена Миронова
UPDATE public.profiles SET telegram_username = 'dsunray'
  WHERE id = 'a1df15d4-24b4-4120-a18e-8f7e000ff574'; -- Даник Миронов
UPDATE public.profiles SET telegram_username = 'irina_yurievna95'
  WHERE id = '44a38a17-bc35-49a8-9a34-27c78310fd9c'; -- Косарева Ирина
UPDATE public.profiles SET telegram_username = 'plyushka_p'
  WHERE id = '1712a00e-da83-4bbb-ad3e-d2884edfce1d'; -- Светлана

-- --- chat_id (перенос из захардкоженного USER_CHAT_MAPPING) ---
UPDATE public.profiles SET telegram_chat_id = -1002614770458
  WHERE id = '943603c3-abd0-47f8-af95-1e60a06fc8b1'; -- Ian Mironov
UPDATE public.profiles SET telegram_chat_id = -1002653986952
  WHERE id = 'de22f2df-66bc-444b-b2b8-104bf79bd166'; -- Акоп Шушанян
UPDATE public.profiles SET telegram_chat_id = -1002851777686
  WHERE id = 'c29869e0-473f-4a3e-a517-687a1a1c0e42'; -- Александра Балукова
UPDATE public.profiles SET telegram_chat_id = -1002701215940
  WHERE id = '2bae2352-8c7c-4b64-9e7d-f419c2f1b595'; -- Антон
UPDATE public.profiles SET telegram_chat_id = -1002625500997
  WHERE id = 'f687a6de-9da9-48e4-ae0d-0460bd03edf3'; -- Глеб Миронов
UPDATE public.profiles SET telegram_chat_id = -1002502050227
  WHERE id = 'a1df15d4-24b4-4120-a18e-8f7e000ff574'; -- Даник Миронов
UPDATE public.profiles SET telegram_chat_id = -1002881581162
  WHERE id = '6f816db9-70f3-463f-b01b-66a1825e505c'; -- Елена Миронова
UPDATE public.profiles SET telegram_chat_id = -1002712226725
  WHERE id = '44a38a17-bc35-49a8-9a34-27c78310fd9c'; -- Косарева Ирина
UPDATE public.profiles SET telegram_chat_id = -1002791005609
  WHERE id = '3438c85f-b7e8-4e19-aa5b-0391441619fb'; -- Настя (бывш.)
UPDATE public.profiles SET telegram_chat_id = -1002602155266
  WHERE id = 'c9fa6e25-b2ae-4e68-ad4e-e50bffebd071'; -- Поздеев Геннадий
UPDATE public.profiles SET telegram_chat_id = -1002715490676
  WHERE id = '1712a00e-da83-4bbb-ad3e-d2884edfce1d'; -- Светлана
UPDATE public.profiles SET telegram_chat_id = -1002592223380
  WHERE id = '7b85819f-b95b-422b-93b0-4f021c178beb'; -- Фаина (бывш.)
UPDATE public.profiles SET telegram_chat_id = -1002629184386
  WHERE id = '5572d59d-960d-43f1-b805-b60e42c2752c'; -- Челтуиторь Екатерина
UPDATE public.profiles SET telegram_chat_id = -1002504122184
  WHERE id = '28906cb8-fb15-40d1-9a8f-13ba4079e6b9'; -- Ян Шейкер
