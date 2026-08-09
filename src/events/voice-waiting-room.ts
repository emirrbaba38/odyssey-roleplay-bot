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
  AudioResource,
} from "@discordjs/voice";
import ytdl from "@distube/ytdl-core";
import googleTTS from "google-tts-api";
import { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repoya eklenen müzik dosyası (assets/waiting-music.mp3), YouTube'a hiç gidilmez.
const LOCAL_MUSIC_PATH = join(__dirname, "..", "..", "assets", "waiting-music.mp3");

const WAITING_VOICE_CHANNEL_NAME = "Kayıt Bekleme";
const MUSIC_URL = "https://www.youtube.com/watch?v=QTe65ySAfRY&list=PLiF7nO4rHMbPjauQWeDJqi2G7g2Ybs3Xr&index=2";
const ANNOUNCEMENT_TEXT =
  "Şu anda kayıtlarımız kapalıdır, çok yakın zamanda açılacaktır.";
// Anons sırasında müziğin kısılacağı ses seviyesi (0-1 arası, 1 = tam ses).
const MUSIC_DUCK_VOLUME = 0.25;

const ANNOUNCEMENT_INTERVAL_MS = 20_000;
const MUSIC_RETRY_BASE_MS = 10_000;
const MUSIC_RETRY_MAX_MS = 120_000;

type Mode = "music" | "announcement";

interface RoomState {
  player: AudioPlayer;
  connection: VoiceConnection;
  mode: Mode;
  // Sıradaki müzik segmentinin dosya içinde nereden başlayacağı (ms).
  offsetMs: number;
  currentResource?: AudioResource;
}

// key: guildId -> aktif bağlantı bilgisi
const activeConnections = new Map<string, RoomState>();
// Aynı anda birden fazla bağlanma denemesini önlemek için.
const connecting = new Set<string>();
// key: guildId -> odada en az 1 insan olduğu sürece 20sn'de bir anons tetikleyen zamanlayıcı.
const announcementIntervals = new Map<string, NodeJS.Timeout>();
// key: guildId -> art arda kaç kez müzik başlatma denemesi başarısız oldu (backoff için).
const musicFailureCounts = new Map<string, number>();
// key: guildId -> bekleyen bir retry zamanlayıcısı var mı.
const musicRetryTimers = new Map<string, NodeJS.Timeout>();

export function registerVoiceWaitingRoom(client: Client): void {
  client.once(Events.ClientReady, async (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      tryConnectToWaitingRoom(guild.id, client).catch((err) =>
        console.error("[kayıt-bekleme] başlangıç bağlantı hatası:", err)
      );
    }
  });

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

      if (!activeConnections.has(guild.id)) {
        await tryConnectToWaitingRoom(guild.id, newState.client);
      }

      evaluatePresence(guild.id, waitingChannel);

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

function spawnFfmpeg(args: string[]) {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary bulunamadı");
  const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  proc.on("error", (err) => console.error("[kayıt-bekleme] ffmpeg process hatası:", err));
  // stderr'i sessizce tüket (ffmpeg logları çok gürültülü, sadece process crash olursa yukarıda yakalanır).
  proc.stderr.on("data", () => {});
  return proc;
}

// Yerel dosyadan, belirtilen ms konumundan itibaren düz müzik akışı üretir (Ogg/Opus).
function createMusicResourceFromOffset(offsetMs: number): AudioResource {
  const offsetSeconds = Math.max(0, offsetMs / 1000).toFixed(2);
  const proc = spawnFfmpeg([
    "-ss", offsetSeconds,
    "-i", LOCAL_MUSIC_PATH,
    "-c:a", "libopus",
    "-f", "ogg",
    "pipe:1",
  ]);
  return createAudioResource(proc.stdout, { inputType: StreamType.OggOpus });
}

// YouTube fallback (yerel dosya yoksa) — offset korunamaz, sadece eski davranış.
function createMusicResourceFromYoutube(): AudioResource {
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

// Anonsu + müziği (kısık ses) aynı anda mixleyip tek bir Ogg/Opus akışı olarak üretir.
// Çıktının uzunluğu anonsun uzunluğu kadardır (duration=first).
function createMixedAnnouncementResource(offsetMs: number, announcementFilePath: string): AudioResource {
  const offsetSeconds = Math.max(0, offsetMs / 1000).toFixed(2);
  const proc = spawnFfmpeg([
    "-i", announcementFilePath,
    "-ss", offsetSeconds,
    "-i", LOCAL_MUSIC_PATH,
    "-filter_complex",
    `[0:a]aresample=48000[a0];[1:a]aresample=48000,volume=${MUSIC_DUCK_VOLUME}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
    "-map", "[aout]",
    "-c:a", "libopus",
    "-f", "ogg",
    "pipe:1",
  ]);
  return createAudioResource(proc.stdout, { inputType: StreamType.OggOpus });
}

function playMusic(guildId: string): void {
  const state = activeConnections.get(guildId);
  if (!state) return;
  state.mode = "music";
  try {
    const resource = existsSync(LOCAL_MUSIC_PATH)
      ? createMusicResourceFromOffset(state.offsetMs)
      : createMusicResourceFromYoutube();
    state.currentResource = resource;
    state.player.play(resource);
  } catch (err) {
    console.error("[kayıt-bekleme] müzik başlatılamadı:", err);
    scheduleMusicRetry(guildId);
  }
}

function scheduleMusicRetry(guildId: string): void {
  if (musicRetryTimers.has(guildId)) return;

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
  if (state.mode === "announcement") return; // zaten çalıyor, üst üste tetikleme

  // Müziğin şu ana kadar ilerlediği kısmı offset'e ekle (kaldığımız yeri işaretle).
  const playedSoFar = state.currentResource?.playbackDuration ?? 0;
  state.offsetMs += playedSoFar;

  if (!existsSync(LOCAL_MUSIC_PATH)) {
    // Yerel dosya yoksa mixleme yapılamaz, eski davranış: TTS'i tek başına çal.
    const resource = await createPlainAnnouncementResource();
    state.mode = "announcement";
    state.currentResource = resource;
    state.player.play(resource);
    return;
  }

  const ttsUrl = googleTTS.getAudioUrl(ANNOUNCEMENT_TEXT, {
    lang: "tr",
    slow: false,
    host: "https://translate.google.com",
  });
  const res = await fetch(ttsUrl);
  if (!res.ok) {
    throw new Error(`TTS indirilemedi: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpPath = join(tmpdir(), `announcement-${guildId}.mp3`);
  await writeFile(tmpPath, buffer);

  const resource = createMixedAnnouncementResource(state.offsetMs, tmpPath);
  state.mode = "announcement";
  state.currentResource = resource;
  state.player.play(resource);
}

async function createPlainAnnouncementResource(): Promise<AudioResource> {
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
    const state: RoomState = { player, connection, mode: "music", offsetMs: 0 };
    activeConnections.set(guildId, state);

    connection.subscribe(player);

    player.on(AudioPlayerStatus.Playing, () => {
      console.log(`[kayıt-bekleme] ▶️ çalıyor (mod: ${state.mode}).`);
      musicFailureCounts.delete(guildId);
    });

    // Bir segment doğal olarak biterse: anonstan sonra offset'i ilerletip müziğe dön,
    // düz müzik dosyanın sonuna gelirse başa sar.
    player.on(AudioPlayerStatus.Idle, () => {
      const current = activeConnections.get(guildId);
      if (!current) return;

      if (current.mode === "announcement") {
        const played = current.currentResource?.playbackDuration ?? 0;
        current.offsetMs += played;
        playMusic(guildId);
      } else {
        current.offsetMs = 0; // dosya sonuna ulaşıldı, başa sar
        playMusic(guildId);
      }
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
