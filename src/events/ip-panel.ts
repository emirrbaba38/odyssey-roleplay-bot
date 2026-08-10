import { Client, Message, EmbedBuilder } from "discord.js";

// IPv4 adresi (isteğe bağlı :port ile) — örn: 192.168.1.1 veya 192.168.1.1:25565
const IP_REGEX =
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b(?::\d{1,5})?/;
// Doğrudan "ip" kelimesi (büyük/küçük harf farketmez, tek başına bir kelime olarak) — örn: "ip", "IP?", "ip nedir"
const IP_WORD_REGEX = /\bip\b/i;

// Aynı kanalda arka arkaya spam olmasın diye kanal başına kısa bir bekleme (ms).
const COOLDOWN_MS = 15_000;
const lastSentAt = new Map<string, number>();

export function registerIpPanel(client: Client): void {
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!IP_REGEX.test(message.content) && !IP_WORD_REGEX.test(message.content)) return;

    const now = Date.now();
    const last = lastSentAt.get(message.channelId) ?? 0;
    if (now - last < COOLDOWN_MS) return;
    lastSentAt.set(message.channelId, now);

    if (!message.channel.isSendable()) return;

    try {
      const guildName = message.guild.name;
      const guildIcon = message.guild.iconURL({ size: 256 }) ?? undefined;
      const botAvatar = client.user?.displayAvatarURL({ size: 256 }) ?? undefined;

      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setAuthor({ name: guildName, iconURL: guildIcon })
        .setDescription(
          `**${guildName} Sunucu IP Bilgi:**\n\`\`\`Şu anlık sunucumuz kapalıdır.\`\`\``
        )
        .setThumbnail(botAvatar ?? null)
        .setTimestamp();

      await message.channel.send({ embeds: [embed] });
    } catch (err) {
      console.error("[ip-panel] Panel gönderilemedi:", err);
    }
  });
}
