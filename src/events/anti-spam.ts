import { Client, Message, EmbedBuilder, TextChannel, Colors } from "discord.js";

// Aynı mesajı üst üste kaç kez yazınca uyarı verilecek.
const WARN_THRESHOLD = 3;
// Aynı mesajı üst üste kaç kez yazınca mesajlar silinecek.
const DELETE_THRESHOLD = 5;
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

    // 3. tekrarda uyarı ver (sadece bir kez).
    if (state.count === WARN_THRESHOLD && !state.warned) {
      state.warned = true;
      if (message.channel.isSendable()) {
        await message.channel
          .send(`⚠️ ${message.author}, hop dur kardeşim! Aynı şeyleri yazma.`)
          .catch(() => {});
      }
    }

    // 5. tekrarda mesajları sil ve logla.
    if (state.count === DELETE_THRESHOLD) {
      const channel = message.channel;
      const idsToDelete = [...state.messageIds];

      if (channel.isTextBased() && "bulkDelete" in channel) {
        try {
          await (channel as TextChannel).bulkDelete(idsToDelete, true);
        } catch {
          // bulkDelete başarısız olursa (örn. 14 günden eski) tek tek dene.
          for (const id of idsToDelete) {
            const msg = await channel.messages.fetch(id).catch(() => null);
            await msg?.delete().catch(() => {});
          }
        }
      }

      await sendSpamLog(client, message, state);

      // Sayaç sıfırlansın, yeniden tetiklenmesin.
      spamMap.delete(key);
    }
  });
}

async function sendSpamLog(
  client: Client,
  message: Message,
  state: SpamState
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
    .setColor(Colors.Red)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 256 }) ?? undefined })
    .setTitle("🚫 Spam Tespit Edildi — Mesajlar Silindi")
    .setThumbnail(botAvatar ?? null)
    .addFields(
      { name: "Kullanıcı", value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
      { name: "Kanal", value: `${message.channel}`, inline: true },
      { name: "Tekrar Sayısı", value: `${state.count} kez`, inline: true },
      { name: "Silinen Mesaj İçeriği", value: `\`\`\`${state.content.slice(0, 500)}\`\`\`` }
    )
    .setFooter({ text: "Anti-Spam Sistemi", iconURL: botAvatar })
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch((err) => {
    console.error("[anti-spam] Log gönderilemedi:", err);
  });
}
