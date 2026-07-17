const { supabase } = require("./supabaseClient");
const { reloadBotChats } = require("./telegramBotChats");

/**
 * Bearer JWT → user + профиль (любая роль). 401 без токена / без профиля.
 * @returns {Promise<object|null>} supabase auth user
 */
async function assertAuthenticatedFromRequest(request, reply) {
  const auth = request.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    reply.code(401).send({ error: "unauthorized", message: "Нужен Authorization: Bearer" });
    return null;
  }

  const token = auth.slice(7).trim();
  if (!token) {
    reply.code(401).send({ error: "unauthorized", message: "Пустой токен" });
    return null;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    reply.code(401).send({ error: "invalid_token", message: userError?.message || "Невалидный токен" });
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    reply.code(500).send({ error: "profile_error", message: profileError.message });
    return null;
  }

  if (!profile) {
    reply.code(401).send({ error: "no_profile", message: "Профиль не найден" });
    return null;
  }

  userData.user._profileRole = profile.role;
  return userData.user;
}

async function assertSuperAdminFromRequest(request, reply) {
  const user = await assertAuthenticatedFromRequest(request, reply);
  if (!user) return null;

  if (user._profileRole !== "superadmin") {
    reply.code(403).send({ error: "forbidden", message: "Только superadmin" });
    return null;
  }

  return user;
}

function registerBotChatsAdminRoutes(fastify) {
  fastify.post("/telegram/bot-chats/reload-cache", async (request, reply) => {
    const user = await assertSuperAdminFromRequest(request, reply);
    if (!user) return;

    const cache = await reloadBotChats();
    console.log(
      `[telegramBotChats] reload-cache по запросу CRM (${user.email || user.id}), чатов: ${cache.byChatId.size}`,
    );
    return reply.send({ ok: true, count: cache.byChatId.size });
  });
}

module.exports = {
  registerBotChatsAdminRoutes,
  assertAuthenticatedFromRequest,
  assertSuperAdminFromRequest,
};
