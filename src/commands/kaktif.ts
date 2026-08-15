import { ChatInputCommandInteraction, EmbedBuilder, Colors, GuildMember, ChannelType } from "discord.js";
import { KAKTIF_ROLE_IDS, memberHasAnyRoleId } from "../lib/permissions.js";

const WAITING_CHANNEL_NAME = "Kayıt Bekleme";

export async function handleKaktifCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  const member = interaction.member;
  if (!guild || !member || !("roles" in member)) {
    await interaction.reply({ content: "❌ Bu komut sadece sunucu içinde kullanılabilir.", ephemeral: true });
    return;
  }

  if (!memberHasAnyRoleId(member as GuildMember, KAKTIF_ROLE_IDS)) {
    await interaction.reply({
      content: "❌ Bu komutu kullanmaya yetkin yok.",
      ephemeral: true,
    });
    return;
  }

  if (!interaction.channel || !("send" in interaction.channel)) {
    await interaction.reply({ content: "❌ Bu kanalda mesaj gönderilemiyor.", ephemeral: true });
    return;
  }

  await guild.channels.fetch().catch(() => {});
  const waitingChannel = guild.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildVoice &&
      ch.name.toLowerCase().startsWith(WAITING_CHANNEL_NAME.toLowerCase())
  );

  const kanalYazisi = waitingChannel ? `<#${waitingChannel.id}>` : `**${WAITING_CHANNEL_NAME}**`;
  const botAvatar = interaction.client.user.displayAvatarURL({ size: 1024, extension: "png" });

  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setAuthor({ name: guild.name, iconURL: interaction.client.user.displayAvatarURL({ size: 128 }) })
    .setDescription(
      `# 📢 Kayıtlar Aktif!\n\n` +
        `**Sayın oyuncularımız, kayıtlarımız aktiftir!**\n` +
        `**Katılım sağlamak için ${kanalYazisi} kanalına geçebilirsiniz.**`
    )
    .setImage(botAvatar)
    .setFooter({ text: guild.name })
    .setTimestamp();

  await interaction.channel.send({
    content: "@everyone @here",
    embeds: [embed],
    allowedMentions: { parse: ["everyone"] },
  });

  await interaction.reply({ content: "✅ Panel gönderildi.", ephemeral: true });
}
