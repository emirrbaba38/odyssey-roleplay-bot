import { Client, Message, EmbedBuilder, TextChannel, Colors, GuildMember } from "discord.js";

// Aynı mesajı üst üste kaç kez yazınca uyarı verilip mesajlar silinecek.
const WARN_THRESHOLD = 3;
// Aynı mesajı üst üste kaç kez yazınca kullanıcıya 1 günlük zaman aşımı (timeout) verilecek.
const TIMEOUT_THRESHOLD = 5;
// Zaman aşımı süresi: 1 gün.
const TIMEOUT_DURATION_MS = 24 * 60 * 60 * 1000;
// Bu süre (ms) içinde tekrar yazılmazsa spam sayacı sıfırlanır.
const RESET_WINDOW_MS = 30_000;
// Logların gönderileceği kanal adı.
const LOG_CHANNEL_NAME = "chat-log";

type SpamState = {
  content: string;
  count: number;
  messageIds: string[];
  lastAt: number;
  warned: boolean;
};

// key: `${channelId}:${userId}`
const spamMap = new Map<string, SpamState>();

export function registerAntiSpam(client: Client): void {
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content.trim();
    if (!content) return;

    const key = `${message.channelId}:${message.author.id}`;
    const now = Date.now();
    const existing = spamMap.get(key);

    let state: SpamState;
    if (
      existing &&
      existing.content === content &&
      now - existing.lastAt <= RESET_WINDOW_MS
    ) {
      state = existing;
      state.count += 1;
      state.messageIds.push(message.id);
      state.lastAt = now;
    } else {
      state = {
        content,
        count: 1,
        messageIds: [message.id],
        lastAt: now,
        warned: false,
      };
    }
    spamMap.set(key, state);

    // 3. tekrarda: kullanıcıyı uyar VE o ana kadarki spam mesajlarını sil.
    if (state.count === WARN_THRESHOLD && !state.warned) {
      state.warned = true;
      const channel = message.channel;

      if (channel.isSendable()) {
        await channel
          .send(`⚠️ ${message.author}, hop dur kardeşim! Aynı şeyleri yazma.`)
          .catch(() => {});
      }

      await deleteMessages(channel, state.messageIds);
      await sendSpamLog(client, message, state, "warn");

      // Silinen mesajları listeden çıkar ama sayaç 5'e doğru artmaya devam etsin.
      state.messageIds = [];
    }

    // 5. tekrarda: yeni spam mesajlarını sil + 1 günlük timeout uygula + logla.
    if (state.count === TIMEOUT_THRESHOLD) {
      const channel = message.channel;
      await deleteMessages(channel, state.messageIds);

      const member = message.member;
      let timeoutApplied = false;
      if (member) {
        try {
          await member.timeout(TIMEOUT_DURATION_MS, "Spam - tekrarlayan mesajlar (otomatik)");
          timeoutApplied = true;
        } catch (err) {
          console.error("[anti-spam] Timeout uygulanamadı:", err);
        }
      }

      await sendSpamLog(client, message, state, "timeout", timeoutApplied);

      // Sayaç sıfırlansın, yeniden tetiklenmesin.
      spamMap.delete(key);
    }
  });
}

async function deleteMessages(channel: Message["channel"], ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (!channel.isTextBased() || !("bulkDelete" in channel)) return;

  try {
    await (channel as TextChannel).bulkDelete(ids, true);
  } catch {
    // bulkDelete başarısız olursa (örn. 14 günden eski) tek tek dene.
    for (const id of ids) {
      const msg = await channel.messages.fetch(id).catch(() => null);
      await msg?.delete().catch(() => {});
    }
  }
}

async function sendSpamLog(
  client: Client,
  message: Message,
  state: SpamState,
  type: "warn" | "timeout",
  timeoutApplied?: boolean
): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const logChannel = guild.channels.cache.find(
    (ch) =>
      ch.isTextBased() &&
      ch.name.trim().toLowerCase() === LOG_CHANNEL_NAME.toLowerCase()
  ) as TextChannel | undefined;

  if (!logChannel) {
    console.warn(
      `[anti-spam] "${LOG_CHANNEL_NAME}" adında bir log kanalı bulunamadı.`
    );
    return;
  }

  const botAvatar = client.user?.displayAvatarURL({ size: 256 }) ?? undefined;

  const embed = new EmbedBuilder()
    .setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 256 }) ?? undefined })
    .setThumbnail(botAvatar ?? null)
    .addFields(
      { name: "Kullanıcı", value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
      { name: "Kanal", value: `${message.channel}`, inline: true },
      { name: "Tekrar Sayısı", value: `${state.count} kez`, inline: true },
      { name: "Mesaj İçeriği", value: `\`\`\`${state.content.slice(0, 500)}\`\`\`` }
    )
    .setFooter({ text: "Anti-Spam Sistemi", iconURL: botAvatar })
    .setTimestamp();

  if (type === "warn") {
    embed.setColor(Colors.Yellow).setTitle("⚠️ Spam Tespit Edildi — Uyarıldı ve Mesajlar Silindi");
  } else {
    embed
      .setColor(Colors.Red)
      .setTitle("🔇 Spam Tespit Edildi — 1 Günlük Zaman Aşımı Uygulandı")
      .addFields({
        name: "Zaman Aşımı",
        value: timeoutApplied ? "✅ 1 gün (24 saat) uygulandı" : "❌ Uygulanamadı (bot izni yetersiz olabilir)",
      });
  }

  await logChannel.send({ embeds: [embed] }).catch((err) => {
    console.error("[anti-spam] Log gönderilemedi:", err);
  });
}
