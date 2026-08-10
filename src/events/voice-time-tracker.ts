import {
  Client,
  VoiceState,
  EmbedBuilder,
  Colors,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
} from "discord.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const DATA_FILE = join(DATA_DIR, "voice-time.json");
const LOG_CHANNEL_NAME = "sesli-bağlantı";

type UserVoiceData = {
  totalMs: number;
  sessionCount: number;
};

type Store = Record<string, UserVoiceData>;

// key: userId -> ses kanalına giriş zamanı (aktif oturumlar, bellekte)
const activeSessions = new Map<string, number>();

let store: Store = {};

function loadStore(): void {
  try {
    if (existsSync(DATA_FILE)) {
      store = JSON.parse(readFileSync(DATA_FILE, "utf-8"));
    }
  } catch {
    store = {};
  }
}

function saveStore(): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[voice-time] Kaydedilemedi:", err);
  }
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} dakika`;
  return `${hours} saat ${minutes} dakika`;
}

export const voiceTimeCommand = new SlashCommandBuilder()
  .setName("sesaktivite")
  .setDescription("Bir kullanıcının toplam sesli sohbet süresini gösterir")
  .addUserOption((opt) =>
    opt.setName("kullanici").setDescription("Kullanıcı").setRequired(false)
  );

export async function handleVoiceTimeCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const target = interaction.options.getUser("kullanici") ?? interaction.user;
  const data = store[target.id] ?? { totalMs: 0, sessionCount: 0 };
  const activeSince = activeSessions.get(target.id);
  const liveMs = activeSince ? Date.now() - activeSince : 0;

  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setAuthor({
      name: interaction.guild?.name ?? "Sunucu",
      iconURL: interaction.guild?.iconURL({ size: 256 }) ?? undefined,
    })
    .setTitle("🎙️ Ses Aktivite Bilgisi")
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "Kullanıcı", value: `${target}`, inline: true },
      { name: "Toplam Süre", value: formatDuration(data.totalMs + liveMs), inline: true },
      { name: "Toplam Giriş Sayısı", value: `${data.sessionCount}`, inline: true },
      {
        name: "Şu An Sesde mi?",
        value: activeSince
          ? `Evet — <t:${Math.floor(activeSince / 1000)}:R> beri`
          : "Hayır",
      }
    )
    .setFooter({
      text: "Ses Aktivite Sistemi",
      iconURL: interaction.client.user?.displayAvatarURL({ size: 256 }),
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

export function registerVoiceTimeTracker(client: Client): void {
  loadStore();

  client.on("voiceStateUpdate", async (oldState: VoiceState, newState: VoiceState) => {
    const userId = newState.id || oldState.id;
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    // Kanala giriş (önce hiç kanalda değilken bir kanala girdi)
    if (!oldState.channelId && newState.channelId) {
      activeSessions.set(userId, Date.now());
      return;
    }

    // Kanaldan tamamen çıkış (başka bir kanala geçiş değil, sesten tamamen ayrıldı)
    if (oldState.channelId && !newState.channelId) {
      const joinedAt = activeSessions.get(userId);
      activeSessions.delete(userId);
      if (!joinedAt) return;

      const leftAt = Date.now();
      const durationMs = leftAt - joinedAt;

      const existing = store[userId] ?? { totalMs: 0, sessionCount: 0 };
      existing.totalMs += durationMs;
      existing.sessionCount += 1;
      store[userId] = existing;
      saveStore();

      await sendVoiceLog(client, member, oldState.channel?.name ?? "Bilinmeyen Kanal", joinedAt, leftAt, durationMs, existing.totalMs);
    }
  });
}

async function sendVoiceLog(
  client: Client,
  member: NonNullable<VoiceState["member"]>,
  channelName: string,
  joinedAt: number,
  leftAt: number,
  durationMs: number,
  totalMs: number
): Promise<void> {
  const guild = member.guild;
  const logChannel = guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.name.trim().toLowerCase() === LOG_CHANNEL_NAME.toLowerCase()
  ) as TextChannel | undefined;

  if (!logChannel) return;

  const botAvatar = client.user?.displayAvatarURL({ size: 256 }) ?? undefined;

  const embed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 256 }) ?? undefined })
    .setTitle("🎙️ Ses Kanalından Ayrıldı")
    .setThumbnail(botAvatar ?? null)
    .addFields(
      { name: "Kullanıcı", value: `${member} (\`${member.user.tag}\`)`, inline: true },
      { name: "Kanal", value: channelName, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Giriş", value: `<t:${Math.floor(joinedAt / 1000)}:f>`, inline: true },
      { name: "Çıkış", value: `<t:${Math.floor(leftAt / 1000)}:f>`, inline: true },
      { name: "Bu Oturum Süresi", value: formatDuration(durationMs), inline: true },
      { name: "Toplam Süre (Tüm Zamanlar)", value: formatDuration(totalMs) }
    )
    .setFooter({ text: "Ses Aktivite Sistemi", iconURL: botAvatar })
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch(() => {});
}
