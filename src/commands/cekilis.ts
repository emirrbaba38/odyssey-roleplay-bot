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
} from "discord.js";
import { KURUCU_ROLE_ID, KURUCU_ROLE_NAME, memberHasRoleId } from "../lib/permissions.js";

export const CEKILIS_JOIN_PREFIX = "cekilis_katil_";
export const CEKILIS_END_PREFIX = "cekilis_bitir_";

interface GiveawayState {
  prize: string;
  hostUsername: string;
  participants: Set<string>;
  ended: boolean;
}

// key: giveawayId (interaction.id, benzersiz) -> durum (bot yeniden başlayınca sıfırlanır)
const giveaways = new Map<string, GiveawayState>();

function buildGiveawayEmbed(guildName: string, botAvatarURL: string | null, state: GiveawayState) {
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
        `\n\n👥 **Katılımcı:** ${state.participants.size}`
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
  const giveawayId = interaction.id;

  const state: GiveawayState = {
    prize,
    hostUsername: interaction.user.username,
    participants: new Set(),
    ended: false,
  };
  giveaways.set(giveawayId, state);

  const botAvatarURL = interaction.client.user?.displayAvatarURL({ size: 512 }) ?? null;
  const embed = buildGiveawayEmbed(guild.name, botAvatarURL, state);
  const row = buildGiveawayRow(giveawayId, false);

  await interaction.reply({ embeds: [embed], components: [row] });
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
  if (state.ended) {
    await interaction.reply({ content: "❌ Bu çekiliş sona erdi, artık katılım alınmıyor.", ephemeral: true });
    return;
  }
  if (state.participants.has(interaction.user.id)) {
    await interaction.reply({ content: "ℹ️ Sadece bu çekilişe katıldın, tekrar katılamazsın.", ephemeral: true });
    return;
  }

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

  state.ended = true;

  const participantIds = Array.from(state.participants);
  const winnerId = participantIds.length > 0 ? participantIds[Math.floor(Math.random() * participantIds.length)] : null;

  const embed = buildGiveawayEmbed(
    interaction.guild?.name ?? "Çekiliş",
    interaction.client.user?.displayAvatarURL({ size: 512 }) ?? null,
    state
  );
  if (winnerId) {
    embed.addFields({ name: "🏆 Kazanan", value: `<@${winnerId}>` });
  }

  await interaction.update({ embeds: [embed], components: [buildGiveawayRow(giveawayId, true)] });

  const channel = interaction.channel as TextChannel | null;
  if (winnerId) {
    await channel
      ?.send({
        content: `🎉 Tebrikler <@${winnerId}>! **${state.prize}** çekilişini kazandın!`,
        allowedMentions: { users: [winnerId] },
      })
      .catch(() => {});
  } else {
    await channel?.send("😕 Bu çekilişe kimse katılmadığı için bir kazanan belirlenemedi.").catch(() => {});
  }
}
