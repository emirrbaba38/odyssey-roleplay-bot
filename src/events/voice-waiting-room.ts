import {
  Client,
  VoiceState,
  ChannelType,
  TextChannel,
  VoiceChannel,
} from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} from "@discordjs/voice";
import ytdl from "@distube/ytdl-core";

const WAITING_VOICE_CHANNEL_NAME = "Kayıt Bekleme";
const MUSIC_URL = "https://www.youtube.com/watch?v=QTe65ySAfRY&list=PLiF7nO4rHMbPjauQWeDJqi2G7g2Ybs3Xr&index=2";
const WAITING_MESSAGE =
  "Şuanda kayıt beklemedesiniz, bir yetkilimiz müsait olunca sizinle ilgilenecektir.";

// key: guildId -> aktif bağlantı bilgisi
const activeConnections = new Map<
  string,
  { player: ReturnType<typeof createAudioPlayer>; connection: ReturnType<typeof joinVoiceChannel> }
>();

export function registerVoiceWaitingRoom(client: Client): void {
  client.on("voiceStateUpdate", async (oldState: VoiceState, newState: VoiceState) => {
    try {
      const guild = newState.guild;
      const waitingChannel = guild.channels.cache.find(
        (ch) =>
          ch.type === ChannelType.GuildVoice &&
          ch.name.toLowerCase().startsWith(WAITING_VOICE_CHANNEL_NAME.toLowerCase())
      ) as VoiceChannel | undefined;

      if (!waitingChannel) return;

      const joinedWaitingChannel =
        newState.channelId === waitingChannel.id && oldState.channelId !== waitingChannel.id;
      const leftWaitingChannel =
        oldState.channelId === waitingChannel.id && newState.channelId !== waitingChannel.id;

      if (joinedWaitingChannel && !newState.member?.user.bot) {
        await handleUserJoinedWaitingRoom(guild.id, waitingChannel);
      }

      if (leftWaitingChannel) {
        const stillHasHumans = waitingChannel.members.some((m) => !m.user.bot);
        if (!stillHasHumans) {
          stopAndLeave(guild.id);
        }
      }
    } catch (err) {
      console.error("[kayıt-bekleme] voiceStateUpdate hatası:", err);
    }
  });
}

async function handleUserJoinedWaitingRoom(guildId: string, waitingChannel: VoiceChannel): Promise<void> {
  // Bot zaten bu kanaldaysa tekrar bağlanmaya/mesaj atmaya gerek yok.
  if (activeConnections.has(guildId)) return;

  try {
    // Kanalın kendi metin sohbetine (voice channel chat) bilgi mesajı gönder.
    if (waitingChannel.isTextBased()) {
      await (waitingChannel as unknown as TextChannel).send(WAITING_MESSAGE).catch((err) => {
        console.error("[kayıt-bekleme] bilgi mesajı gönderilemedi:", err);
      });
    }

    const connection = joinVoiceChannel({
      channelId: waitingChannel.id,
      guildId: waitingChannel.guild.id,
      adapterCreator: waitingChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

    const player = createAudioPlayer();
    const stream = ytdl(MUSIC_URL, { filter: "audioonly", highWaterMark: 1 << 25 });
    const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });

    player.play(resource);
    connection.subscribe(player);
    activeConnections.set(guildId, { player, connection });

    // Şarkı bitince baştan başlat (bekleme odasında sürekli müzik çalsın).
    player.on(AudioPlayerStatus.Idle, () => {
      const current = activeConnections.get(guildId);
      if (!current) return;
      try {
        const loopStream = ytdl(MUSIC_URL, { filter: "audioonly", highWaterMark: 1 << 25 });
        const loopResource = createAudioResource(loopStream, { inputType: StreamType.Arbitrary });
        current.player.play(loopResource);
      } catch (err) {
        console.error("[kayıt-bekleme] müzik tekrar başlatılamadı:", err);
      }
    });

    player.on("error", (err) => {
      console.error("[kayıt-bekleme] audio player hatası:", err);
    });
  } catch (err) {
    console.error("[kayıt-bekleme] ses kanalına bağlanılamadı:", err);
    stopAndLeave(guildId);
  }
}

function stopAndLeave(guildId: string): void {
  const current = activeConnections.get(guildId);
  if (!current) return;
  try {
    current.player.stop();
    current.connection.destroy();
  } catch (err) {
    console.error("[kayıt-bekleme] bağlantı kapatılırken hata:", err);
  }
  activeConnections.delete(guildId);
}
