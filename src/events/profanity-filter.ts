import { Client, Message, EmbedBuilder, Colors } from "discord.js";

const LOG_CHANNEL_NAME = "chat-log";

// Yasaklı kelime/kalıplar (küçük harfe çevrilip, boşluk/nokta/yıldız gibi
// ayraçlar temizlenerek kontrol edilir, bu yüzden "a.m.ı.n.a" gibi yazımları da yakalar).
const BANNED_PATTERNS: string[] = [
  // Küfürler
  "aminakoyim", "aminakoyayim", "amınakoyim", "amcikoyim",
  "sikerim", "sikeyim", "siktir", "sikik", "yarrak", "yarak",
  "orospucocugu", "orospucocuğu", "orospu", "piç", "pic",
  "ananisikim", "ananısikim", "ananısiktiğim", "ananisiktigim",
  "babanisikim", "babanısikim",
  "amk", "aq", "oç", "oc ", "mk ",
  "göt", "got herif", "gotveren", "götveren", "ibne", "top",

  // Ata / büyüklere hakaret
  "ataturksikim", "atatürksikim", "atatürkesiktir", "ataturkesiktir",
  "fatihsultanmehmetsikim", "fatihsultanmehmedesiktir",

  // Dini hakaret
  "allahasiktir", "allahasikim", "allahına", "peygamberesiktir",
  "peygambersikim", "kitabasiktir", "kuranasiktir", "kur'anasiktir",
];

function normalize(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-zçğıöşü0-9]/g, "");
}

function containsProfanity(rawContent: string): string | null {
  const normalized = normalize(rawContent);
  for (const pattern of BANNED_PATTERNS) {
    const cleanPattern = normalize(pattern);
    if (cleanPattern && normalized.includes(cleanPattern)) {
      return pattern;
    }
  }
  return null;
}

export function registerProfanityFilter(client: Client): void {
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content.trim();
    if (!content) return;

    const matched = containsProfanity(content);
    if (!matched) return;

    await message.delete().catch(() => {});
    await sendProfanityLog(client, message, content);
  });
}

async function sendProfanityLog(
  client: Client,
  message: Message,
  content: string
): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const logChannel = guild.channels.cache.find(
    (ch) =>
      ch.isTextBased() &&
      ch.name.trim().toLowerCase() === LOG_CHANNEL_NAME.toLowerCase()
  ) as import("discord.js").TextChannel | undefined;

  if (!logChannel) {
    console.warn(
      `[profanity-filter] "${LOG_CHANNEL_NAME}" adında bir log kanalı bulunamadı.`
    );
    return;
  }

  const botAvatar = client.user?.displayAvatarURL({ size: 256 }) ?? undefined;

  const embed = new EmbedBuilder()
    .setColor(Colors.DarkRed)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 256 }) ?? undefined })
    .setTitle("🚫 Küfür / Hakaret Tespit Edildi — Mesaj Silindi")
    .setThumbnail(botAvatar ?? null)
    .addFields(
      { name: "Kullanıcı", value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
      { name: "Kanal", value: `${message.channel}`, inline: true },
      { name: "Tarih", value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
      { name: "Silinen Mesaj İçeriği", value: `\`\`\`${content.slice(0, 1000)}\`\`\`` }
    )
    .setFooter({ text: "Küfür Filtresi Sistemi", iconURL: botAvatar })
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch((err) => {
    console.error("[profanity-filter] Log gönderilemedi:", err);
  });
}
