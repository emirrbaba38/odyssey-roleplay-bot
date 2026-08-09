import { Client, VoiceState, ChannelType, VoiceChannel, Events } from "discord.js";
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
import googleTTS from "google-tts-api";
import { Readable } from "node:stream";

const WAITING_VOICE_CHANNEL_NAME = "Kayıt Bekleme";
const MUSIC_URL = "https://www.youtube.com/watch?v=QTe65ySAfRY&list=PLiF7nO4rHMbPjauQWeDJqi2G7g2Ybs3Xr&index=2";
const ANNOUNCEMENT_TEXT =
  "Şu anda kayıtlarımız kapalıdır, çok yakın zamanda açılacaktır.";

const ANNOUNCEMENT_INTERVAL_MS = 20_000;

type Mode = "music" | "announcement";

interface RoomState {
  player: AudioPlayer;
  connection: VoiceConnection;
  mode: Mode;
}

// key: guildId -> aktif bağlantı bilgisi
const activeConnections = new Map<string, RoomState>();
// Aynı anda birden fazla bağlanma denemesini önlemek için.
const connecting = new Set<string>();
// key: guildId -> odada en az 1 insan olduğu sürece 20sn'de bir anons tetikleyen zamanlayıcı.
const announcementIntervals = new Map<string, NodeJS.Timeout>();

export function registerVoiceWaitingRoom(client: Client): void {
  // Bot açıldığında (ve zaten sunucularda olduğu için) hemen bağlanmayı dene.
  client.once(Events.ClientReady, async (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      tryConnectToWaitingRoom(guild.id, client).catch((err) =>
        console.error("[kayıt-bekleme] başlangıç bağlantı hatası:", err)
      );
    }
  });

  // Yeni bir sunucuya eklenirse de dene.
  client.on(Events.GuildCreate, async (guild) => {
    tryConnectToWaitingRoom(guild.id, client).catch((err) =>
      console.error("[kayıt-bekleme] guildCreate bağlantı hatası:", err)
    );
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

      // Kanaldaki insan sayısı her değişimde yeniden değerlendirilir (giriş/çıkış).
      evaluatePresence(guild.id, waitingChannel);

      // Bot Discord tarafından kanaldan atılırsa (örn. biri onu manuel sürüklerse)
      // tekrar bağlanmayı dene.
      if (newState.member?.user.id === client.user?.id && newState.channelId !== waitingChannel.id) {
        cleanupConnection(guild.id);
        await tryConnectToWaitingRoom(guild.id, client);
      }
    } catch (err) {
      console.error("[kayıt-bekleme] voiceStateUpdate hatası:", err);
    }
  });
}

function countHumans(channel: VoiceChannel): number {
  return channel.members.filter((m) => !m.user.bot).size;
}

function evaluatePresence(guildId: string, waitingChannel: VoiceChannel): void {
  const humanCount = countHumans(waitingChannel);

  if (humanCount > 0) {
    if (!announcementIntervals.has(guildId)) {
      // Odaya ilk giren için hemen bir anons + 20sn'de bir tekrar.
      playAnnouncement(guildId).catch((err) =>
        console.error("[kayıt-bekleme] anons çalınamadı:", err)
      );
      const interval = setInterval(() => {
        playAnnouncement(guildId).catch((err) =>
          console.error("[kayıt-bekleme] anons çalınamadı:", err)
        );
      }, ANNOUNCEMENT_INTERVAL_MS);
      announcementIntervals.set(guildId, interval);
    }
  } else {
    const interval = announcementIntervals.get(guildId);
    if (interval) {
      clearInterval(interval);
      announcementIntervals.delete(guildId);
    }
  }
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
  stream.on("error", (err: any) => {
    console.error(
      `[kayıt-bekleme] ytdl akış hatası: ${err?.message ?? err} (statusCode: ${err?.statusCode ?? "?"})`
    );
  });
  return createAudioResource(stream, { inputType: StreamType.Arbitrary });
}

async function createAnnouncementResource() {
  const url = googleTTS.getAudioUrl(ANNOUNCEMENT_TEXT, {
    lang: "tr",
    slow: false,
    host: "https://translate.google.com",
  });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TTS indirilemedi: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const stream = Readable.from(buffer);
  return createAudioResource(stream, { inputType: StreamType.Arbitrary });
}

function playMusic(guildId: string): void {
  const state = activeConnections.get(guildId);
  if (!state) return;
  state.mode = "music";
  try {
    const resource = createMusicResource();
    state.player.play(resource);
  } catch (err) {
    console.error("[kayıt-bekleme] müzik başlatılamadı:", err);
  }
}

async function playAnnouncement(guildId: string): Promise<void> {
  const state = activeConnections.get(guildId);
  if (!state) return;
  // Zaten bir anons çalıyorsa üst üste tetikleme.
  if (state.mode === "announcement") return;

  state.mode = "announcement";
  const resource = await createAnnouncementResource();
  state.player.play(resource);
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
      selfDeaf: true,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    console.log("[kayıt-bekleme] ses kanalına bağlanıldı, müzik başlatılıyor...");

    const player = createAudioPlayer();
    const state: RoomState = { player, connection, mode: "music" };
    activeConnections.set(guildId, state);

    connection.subscribe(player);

    player.on(AudioPlayerStatus.Playing, () => {
      console.log(`[kayıt-bekleme] ▶️ çalıyor (mod: ${state.mode}).`);
    });

    // Bir kaynak bitince: anonstan sonra müziğe dön, müzik bitince müziği yeniden başlat.
    player.on(AudioPlayerStatus.Idle, () => {
      const current = activeConnections.get(guildId);
      if (!current) return;
      if (current.mode === "announcement") {
        playMusic(guildId);
      } else {
        try {
          const nextResource = createMusicResource();
          current.player.play(nextResource);
        } catch (err) {
          console.error("[kayıt-bekleme] müzik tekrar başlatılamadı:", err);
        }
      }
    });

    player.on("error", (err) => {
      console.error("[kayıt-bekleme] audio player hatası, müziğe dönülüyor:", err);
      playMusic(guildId);
    });

    playMusic(guildId);
    evaluatePresence(guildId, waitingChannel);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.warn("[kayıt-bekleme] bağlantı koptu, yeniden bağlanılıyor...");
      cleanupConnection(guildId);
      setTimeout(() => {
        tryConnectToWaitingRoom(guildId, client).catch((err) =>
          console.error("[kayıt-bekleme] yeniden bağlanma hatası:", err)
        );
      }, 3000);
    });
  } catch (err) {
    console.error("[kayıt-bekleme] ses kanalına bağlanılamadı:", err);
    cleanupConnection(guildId);
  } finally {
    connecting.delete(guildId);
  }
}

function cleanupConnection(guildId: string): void {
  const interval = announcementIntervals.get(guildId);
  if (interval) {
    clearInterval(interval);
    announcementIntervals.delete(guildId);
  }

  const state = activeConnections.get(guildId);
  if (state) {
    try {
      state.player.stop();
    } catch {
      // yoksay
    }
    try {
      state.connection.destroy();
    } catch {
      // yoksay — bağlantı zaten kapanmış olabilir
    }
  }
  activeConnections.delete(guildId);
}
