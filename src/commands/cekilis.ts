import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  GuildMember,
  TextChannel,
  Client,
} from "discord.js";
import { KURUCU_ROLE_ID, KURUCU_ROLE_NAME, memberHasRoleId } from "../lib/permissions.js";

export const CEKILIS_JOIN_PREFIX = "cekilis_katil_";
export const CEKILIS_END_PREFIX = "cekilis_bitir_";

const UPDATE_INTERVAL_MS = 15_000; // panel her 15 saniyede bir güncellenir

interface GiveawayState {
  prize: string;
  hostUsername: string;
  participants: Set<string>;
  ended: boolean;
  endsAt: number; // Date.now() + süre (ms)
  guildId: string;
  channelId: string;
  messageId: string | null;
  timer: ReturnType<typeof setInterval> | null;
}

// key: giveawayId (interaction.id, benzersiz) -> durum (bot yeniden başlayınca sıfırlanır)
const giveaways = new Map<string, GiveawayState>();

/** Kalan süreyi "1 saat 7 dakika" gibi okunur bir metne çevirir. */
function formatRemaining(ms: number): string {
  if (ms <= 0) return "Süre doldu";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} saat`);
  if (hours > 0 || minutes > 0) parts.push(`${minutes} dakika`);
  if (hours === 0 && minutes === 0) parts.push(`${seconds} saniye`);
  return parts.join(" ");
}

function buildGiveawayEmbed(guildName: string, botAvatarURL: string | null, state: GiveawayState) {
  const remainingMs = state.endsAt - Date.now();
  const embed = new EmbedBuilder()
    .setColor(state.ended ? Colors.Greyple : Colors.Gold)
    .setAuthor({ name: guildName, iconURL: botAvatarURL ?? undefined })
    .setTitle(state.ended ? "🎉 Çekiliş Sona Erdi" : "🎉 Çekiliş Başladı!")
    .setDescription(
      `${state.prize}\n\n` +
        (state.ended
          ? "▫️ Bu çekiliş kapandı, artık katılım alınmıyor."
          : "▫️ Katılmak için aşağıdaki **🎉 Katıl** butonuna tıkla\n" +
            "▫️ Bir çekilişe sadece **1 kez** katılabilirsin") +
        `\n\n⏰ **Kalan süre:** ${state.ended ? "Sona erdi" : formatRemaining(remainingMs)}` +
        `\n👥 **Katılımcı:** ${state.participants.size}`
    )
    .setThumbnail(botAvatarURL)
    .setFooter({ text: `Çekilişi başlatan: ${state.hostUsername}` })
    .setTimestamp();
  return embed;
}

function buildGiveawayRow(giveawayId: string, ended: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CEKILIS_JOIN_PREFIX}${giveawayId}`)
      .setLabel("Katıl")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Success)
      .setDisabled(ended),
    new ButtonBuilder()
      .setCustomId(`${CEKILIS_END_PREFIX}${giveawayId}`)
      .setLabel(ended ? "Sona Erdi" : "Çekilişi Bitir")
      .setEmoji("🏁")
      .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Danger)
      .setDisabled(ended)
  );
}

/** Çekilişi kapatır: kazananı seçer, paneli ve mesajı günceller, timer'ı temizler. */
async function finishGiveaway(client: Client, giveawayId: string, state: GiveawayState): Promise<void> {
  if (state.ended) return;
  state.ended = true;

  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  const participantIds = Array.from(state.participants);
  const winnerId = participantIds.length > 0 ? participantIds[Math.floor(Math.random() * participantIds.length)] : null;

  try {
    const channel = (await client.channels.fetch(state.channelId)) as TextChannel | null;
    if (!channel) return;

    const guild = channel.guild;
    const botAvatarURL = client.user?.displayAvatarURL({ size: 512 }) ?? null;
    const embed = buildGiveawayEmbed(guild?.name ?? "Çekiliş", botAvatarURL, state);
    if (winnerId) {
      embed.addFields({ name: "🏆 Kazanan", value: `<@${winnerId}>` });
    }

    if (state.messageId) {
      const message = await channel.messages.fetch(state.messageId).catch(() => null);
      if (message) {
        await message.edit({ embeds: [embed], components: [buildGiveawayRow(giveawayId, true)] }).catch(() => {});
      }
    }

    if (winnerId) {
      await channel
        .send({
          content: `🎉 Tebrikler <@${winnerId}>! **${state.prize}** çekilişini kazandın!`,
          allowedMentions: { users: [winnerId] },
        })
        .catch(() => {});
    } else {
      await channel.send("😕 Bu çekilişe kimse katılmadığı için bir kazanan belirlenemedi.").catch(() => {});
    }
  } catch (err) {
    console.error(`Çekiliş (${giveawayId}) otomatik sonlandırılırken hata:`, err);
  }
}

/** Paneldeki geri sayımı günceller; süre dolduysa çekilişi otomatik bitirir. */
function startCountdown(client: Client, giveawayId: string, state: GiveawayState): void {
  state.timer = setInterval(async () => {
    if (state.ended) {
      if (state.timer) clearInterval(state.timer);
      return;
    }

    if (Date.now() >= state.endsAt) {
      await finishGiveaway(client, giveawayId, state);
      return;
    }

    try {
      const channel = (await client.channels.fetch(state.channelId)) as TextChannel | null;
      if (!channel || !state.messageId) return;
      const message = await channel.messages.fetch(state.messageId).catch(() => null);
      if (!message) return;

      const guild = channel.guild;
      const botAvatarURL = client.user?.displayAvatarURL({ size: 512 }) ?? null;
      const embed = buildGiveawayEmbed(guild?.name ?? "Çekiliş", botAvatarURL, state);
      await message.edit({ embeds: [embed], components: [buildGiveawayRow(giveawayId, false)] }).catch(() => {});
    } catch (err) {
      console.error(`Çekiliş (${giveawayId}) geri sayımı güncellenirken hata:`, err);
    }
  }, UPDATE_INTERVAL_MS);
}

export async function handleCekilisCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  const executor = interaction.member;
  if (!guild || !executor || !("roles" in executor)) {
    await interaction.reply({ content: "❌ Bu komut sadece sunucu içinde kullanılabilir.", ephemeral: true });
    return;
  }

  if (!memberHasRoleId(executor as GuildMember, KURUCU_ROLE_ID)) {
    await interaction.reply({
      content: `❌ Bu komutu sadece **${KURUCU_ROLE_NAME}** kullanabilir.`,
      ephemeral: true,
    });
    return;
  }

  const prize = interaction.options.getString("ödül", true);
  const saat = interaction.options.getInteger("saat") ?? 0;
  const dakika = interaction.options.getInteger("dakika") ?? 0;
  const totalMs = (saat * 60 + dakika) * 60 * 1000;

  if (totalMs <= 0) {
    await interaction.reply({
      content: "❌ Çekilişin ne zaman biteceğini girmelisin (`saat` ve/veya `dakika`, en az 1 dakika).",
      ephemeral: true,
    });
    return;
  }

  const giveawayId = interaction.id;

  const state: GiveawayState = {
    prize,
    hostUsername: interaction.user.username,
    participants: new Set(),
    ended: false,
    endsAt: Date.now() + totalMs,
    guildId: guild.id,
    channelId: interaction.channelId,
    messageId: null,
    timer: null,
  };
  giveaways.set(giveawayId, state);

  const botAvatarURL = interaction.client.user?.displayAvatarURL({ size: 512 }) ?? null;
  const embed = buildGiveawayEmbed(guild.name, botAvatarURL, state);
  const row = buildGiveawayRow(giveawayId, false);

  await interaction.reply({ embeds: [embed], components: [row] });
  const replyMessage = await interaction.fetchReply().catch(() => null);
  if (replyMessage) {
    state.messageId = replyMessage.id;
  }

  startCountdown(interaction.client, giveawayId, state);
}

export async function handleCekilisJoinButton(interaction: ButtonInteraction): Promise<void> {
  const giveawayId = interaction.customId.replace(CEKILIS_JOIN_PREFIX, "");
  const state = giveaways.get(giveawayId);

  if (!state) {
    await interaction.reply({
      content: "❌ Bu çekiliş artık bulunamıyor (bot yeniden başlamış olabilir).",
      ephemeral: true,
    });
    return;
  }
  if (state.ended || Date.now() >= state.endsAt) {
    await interaction.reply({ content: "❌ Bu çekiliş sona erdi, artık katılım alınmıyor.", ephemeral: true });
    return;
  }
  if (state.participants.has(interaction.user.id)) {
    await interaction.reply({ content: "ℹ️ Sadece bu çekilişe katıldın, tekrar katılamazsın.", ephemeral: true });
    return;
  }

  // Not: katılım sadece bu Set'e ekleniyor, herhangi bir kanal/ticket açılmıyor.
  state.participants.add(interaction.user.id);

  const embed = buildGiveawayEmbed(
    interaction.guild?.name ?? "Çekiliş",
    interaction.client.user?.displayAvatarURL({ size: 512 }) ?? null,
    state
  );

  await interaction.update({ embeds: [embed], components: [buildGiveawayRow(giveawayId, false)] });
  await interaction.followUp({ content: "✅ Çekilişe katıldın! Bol şans 🍀", ephemeral: true }).catch(() => {});
}

export async function handleCekilisEndButton(interaction: ButtonInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("roles" in member)) {
    await interaction.reply({ content: "❌ Bu işlem sadece sunucuda yapılabilir.", ephemeral: true });
    return;
  }
  if (!memberHasRoleId(member as GuildMember, KURUCU_ROLE_ID)) {
    await interaction.reply({
      content: `❌ Bu çekilişi sadece **${KURUCU_ROLE_NAME}** bitirebilir.`,
      ephemeral: true,
    });
    return;
  }

  const giveawayId = interaction.customId.replace(CEKILIS_END_PREFIX, "");
  const state = giveaways.get(giveawayId);

  if (!state) {
    await interaction.reply({ content: "❌ Bu çekiliş artık bulunamıyor.", ephemeral: true });
    return;
  }
  if (state.ended) {
    await interaction.reply({ content: "ℹ️ Bu çekiliş zaten sona erdi.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate().catch(() => {});
  await finishGiveaway(interaction.client, giveawayId, state);
}
