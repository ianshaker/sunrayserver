const { supabase } = require("./supabaseClient");
const { reloadBotChats } = require("./telegramBotChats");

async function assertSuperAdminFromRequest(request, reply) {
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
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    reply.code(500).send({ error: "profile_error", message: profileError.message });
    return null;
  }

  if (profile?.role !== "superadmin") {
    reply.code(403).send({ error: "forbidden", message: "Только superadmin" });
    return null;
  }

  return userData.user;
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

module.exports = { registerBotChatsAdminRoutes };
