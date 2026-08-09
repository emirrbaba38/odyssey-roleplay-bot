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
import { existsSync, createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repoya bir müzik dosyası eklenirse (örn. assets/waiting-music.mp3), YouTube'a hiç gidilmez.
const LOCAL_MUSIC_PATH = join(__dirname, "..", "..", "assets", "waiting-music.mp3");

const WAITING_VOICE_CHANNEL_NAME = "Kayıt Bekleme";
const MUSIC_URL = "https://www.youtube.com/watch?v=QTe65ySAfRY&list=PLiF7nO4rHMbPjauQWeDJqi2G7g2Ybs3Xr&index=2";
const ANNOUNCEMENT_TEXT =
  "Şu anda kayıtlarımız kapalıdır, çok yakın zamanda açılacaktır.";

const ANNOUNCEMENT_INTERVAL_MS = 20_000;
const MUSIC_RETRY_BASE_MS = 10_000;
const MUSIC_RETRY_MAX_MS = 120_000;

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
// key: guildId -> art arda kaç kez müzik başlatma denemesi başarısız oldu (backoff için).
const musicFailureCounts = new Map<string, number>();
// key: guildId -> bekleyen bir retry zamanlayıcısı var mı (üst üste retry planlamayı önlemek için).
const musicRetryTimers = new Map<string, NodeJS.Timeout>();

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
  if (existsSync(LOCAL_MUSIC_PATH)) {
    const stream = createReadStream(LOCAL_MUSIC_PATH);
    stream.on("error", (err) => {
      console.error("[kayıt-bekleme] yerel müzik dosyası okunamadı:", err);
    });
    return createAudioResource(stream, { inputType: StreamType.Arbitrary });
  }

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
    scheduleMusicRetry(guildId);
  }
}

// Art arda başarısız denemelerde YouTube'u/log'ları spamlememek için artan bekleme süresiyle tekrar dener.
function scheduleMusicRetry(guildId: string): void {
  if (musicRetryTimers.has(guildId)) return; // zaten bekleyen bir retry var

  const failures = (musicFailureCounts.get(guildId) ?? 0) + 1;
  musicFailureCounts.set(guildId, failures);

  const delay = Math.min(MUSIC_RETRY_BASE_MS * 2 ** (failures - 1), MUSIC_RETRY_MAX_MS);
  console.warn(
    `[kayıt-bekleme] müzik ${failures}. kez başarısız oldu, ${Math.round(delay / 1000)}sn sonra tekrar denenecek.`
  );

  const timer = setTimeout(() => {
    musicRetryTimers.delete(guildId);
    playMusic(guildId);
  }, delay);
  musicRetryTimers.set(guildId, timer);
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
      musicFailureCounts.delete(guildId);
    });

    // Bir kaynak bitince (anons ya da müzik), sırada müzik çalsın.
    player.on(AudioPlayerStatus.Idle, () => {
      if (!activeConnections.has(guildId)) return;
      playMusic(guildId);
    });

    player.on("error", (err) => {
      console.error("[kayıt-bekleme] audio player hatası:", err);
      scheduleMusicRetry(guildId);
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

  const retryTimer = musicRetryTimers.get(guildId);
  if (retryTimer) {
    clearTimeout(retryTimer);
    musicRetryTimers.delete(guildId);
  }
  musicFailureCounts.delete(guildId);

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
