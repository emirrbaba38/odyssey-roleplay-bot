import { Client, VoiceState, ChannelType, TextChannel, VoiceChannel, Events } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  VoiceConnection,
  AudioPlayer,
} from "@discordjs/voice";
import ytdl from "@distube/ytdl-core";

const WAITING_VOICE_CHANNEL_NAME = "Kayıt Bekleme";
const MUSIC_URL = "https://www.youtube.com/watch?v=QTe65ySAfRY&list=PLiF7nO4rHMbPjauQWeDJqi2G7g2Ybs3Xr&index=2";
const WAITING_MESSAGE =
  "Şuanda kayıt beklemedesiniz, bir yetkilimiz müsait olunca sizinle ilgilenecektir.";

// key: guildId -> aktif bağlantı bilgisi
const activeConnections = new Map<string, { player: AudioPlayer; connection: VoiceConnection }>();
// Aynı anda birden fazla bağlanma denemesini önlemek için.
const connecting = new Set<string>();

export function registerVoiceWaitingRoom(client: Client): void {
  // Bot açıldığında (ve zaten sunucularda olduğu için) hemen bağlanmayı dene.
  client.once(Events.ClientReady, async (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      await tryConnectToWaitingRoom(guild.id, client);
    }
  });

  // Yeni bir sunucuya eklenirse de dene.
  client.on(Events.GuildCreate, async (guild) => {
    await tryConnectToWaitingRoom(guild.id, client);
  });

  client.on("voiceStateUpdate", async (oldState: VoiceState, newState: VoiceState) => {
    try {
      const guild = newState.guild;
      const waitingChannel = findWaitingChannel(guild);
      if (!waitingChannel) return;

      // Bot henüz bağlı değilse (kanal sonradan oluşturulmuş olabilir) bağlan.
      if (!activeConnections.has(guild.id)) {
        await tryConnectToWaitingRoom(guild.id, newState.client);
      }

      const joinedWaitingChannel =
        newState.channelId === waitingChannel.id && oldState.channelId !== waitingChannel.id;

      if (joinedWaitingChannel && !newState.member?.user.bot) {
        if (waitingChannel.isTextBased()) {
          await (waitingChannel as unknown as TextChannel).send(WAITING_MESSAGE).catch((err) => {
            console.error("[kayıt-bekleme] bilgi mesajı gönderilemedi:", err);
          });
        }
      }

      // Bot Discord tarafından kanaldan atılırsa (örn. biri onu manuel sürüklerse)
      // tekrar bağlanmayı dene.
      if (newState.member?.user.id === client.user?.id && newState.channelId !== waitingChannel.id) {
        activeConnections.delete(guild.id);
        await tryConnectToWaitingRoom(guild.id, client);
      }
    } catch (err) {
      console.error("[kayıt-bekleme] voiceStateUpdate hatası:", err);
    }
  });
}

function findWaitingChannel(guild: import("discord.js").Guild): VoiceChannel | undefined {
  return guild.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildVoice &&
      ch.name.toLowerCase().startsWith(WAITING_VOICE_CHANNEL_NAME.toLowerCase())
  ) as VoiceChannel | undefined;
}

function createMusicResource() {
  const stream = ytdl(MUSIC_URL, {
    filter: "audioonly",
    quality: "highestaudio",
    highWaterMark: 1 << 25,
  });
  stream.on("error", (err) => {
    console.error("[kayıt-bekleme] ytdl akış hatası:", err);
  });
  return createAudioResource(stream, { inputType: StreamType.Arbitrary });
}

async function tryConnectToWaitingRoom(guildId: string, client: Client): Promise<void> {
  if (activeConnections.has(guildId) || connecting.has(guildId)) return;
  connecting.add(guildId);

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const waitingChannel = findWaitingChannel(guild);
    if (!waitingChannel) {
      console.warn(
        `[kayıt-bekleme] "${WAITING_VOICE_CHANNEL_NAME}" ile başlayan bir ses kanalı bulunamadı ("${guild.name}").`
      );
      return;
    }

    console.log(`[kayıt-bekleme] "${waitingChannel.name}" kanalına bağlanılıyor...`);

    const connection = joinVoiceChannel({
      channelId: waitingChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    console.log("[kayıt-bekleme] ses kanalına bağlanıldı, müzik başlatılıyor...");

    const player = createAudioPlayer();
    activeConnections.set(guildId, { player, connection });

    const resource = createMusicResource();
    player.play(resource);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Playing, () => {
      console.log("[kayıt-bekleme] ▶️ müzik çalınıyor.");
    });

    // Şarkı/liste bitince veya hata olunca baştan başlat — sürekli çalsın.
    player.on(AudioPlayerStatus.Idle, () => {
      const current = activeConnections.get(guildId);
      if (!current) return;
      try {
        const nextResource = createMusicResource();
        current.player.play(nextResource);
      } catch (err) {
        console.error("[kayıt-bekleme] müzik tekrar başlatılamadı:", err);
      }
    });

    player.on("error", (err) => {
      console.error("[kayıt-bekleme] audio player hatası, tekrar denenecek:", err);
      try {
        const retryResource = createMusicResource();
        player.play(retryResource);
      } catch (retryErr) {
        console.error("[kayıt-bekleme] yeniden deneme de başarısız:", retryErr);
      }
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.warn("[kayıt-bekleme] bağlantı koptu, yeniden bağlanılıyor...");
      activeConnections.delete(guildId);
      setTimeout(() => tryConnectToWaitingRoom(guildId, client), 3000);
    });
  } catch (err) {
    console.error("[kayıt-bekleme] ses kanalına bağlanılamadı:", err);
    activeConnections.delete(guildId);
  } finally {
    connecting.delete(guildId);
  }
}
