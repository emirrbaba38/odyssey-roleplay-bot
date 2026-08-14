import { ChatInputCommandInteraction, EmbedBuilder, Colors, GuildMember } from "discord.js";
import {
  YETKILI_EKIBI_ROLE_NAME,
  YETKILI_EKIBI_ROLE_ID,
  NEW_PLAYER_ROLE_NAME,
  WHITELIST_ROLE_NAME,
  memberHasRoleId,
  findRoleByName,
} from "../lib/permissions.js";
import { incrementRegistration } from "../lib/registration-stats.js";

export async function handleKayitCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  const executor = interaction.member;
  if (!guild || !executor || !("roles" in executor)) {
    await interaction.reply({ content: "❌ Bu komut sadece sunucu içinde kullanılabilir.", ephemeral: true });
    return;
  }

  if (!memberHasRoleId(executor as GuildMember, YETKILI_EKIBI_ROLE_ID)) {
    await interaction.reply({
      content: `❌ Bu komutu sadece **${YETKILI_EKIBI_ROLE_NAME}** kullanabilir.`,
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser("kişi", true);
  const isim = interaction.options.getString("isim", true);

  await interaction.deferReply();

  try {
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.editReply("❌ Bu kullanıcı sunucuda bulunamadı.");
      return;
    }

    const whitelistRole = findRoleByName(guild, WHITELIST_ROLE_NAME);
    if (!whitelistRole) {
      await interaction.editReply(`❌ **${WHITELIST_ROLE_NAME}** adında bir rol bulunamadı, önce bu rolü oluşturman gerekiyor.`);
      return;
    }

    const newPlayerRole = findRoleByName(guild, NEW_PLAYER_ROLE_NAME);
    if (newPlayerRole && targetMember.roles.cache.has(newPlayerRole.id)) {
      await targetMember.roles.remove(newPlayerRole).catch(() => {});
    }

    if (!targetMember.roles.cache.has(whitelistRole.id)) {
      await targetMember.roles.add(whitelistRole);
    }

    let nicknameChanged = true;
    try {
      await targetMember.setNickname(isim);
    } catch (err) {
      // Bot'un rolü hedef üyeden daha altta olabilir (ör. sunucu sahibi/Kurucu) — Discord izin vermez.
      nicknameChanged = false;
      console.error("[kayit] takma ad değiştirilemedi:", err);
    }

    incrementRegistration(interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle("✅ Kayıt Tamamlandı")
      .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
      .setDescription(
        `**Kayıt Edilen:** ${targetUser}\n` +
          `**İsim:** ${isim}\n` +
          `**Kayıt Eden:** ${interaction.user}\n\n` +
          `▫️ **${NEW_PLAYER_ROLE_NAME}** rolü alındı\n` +
          `▫️ **${WHITELIST_ROLE_NAME}** rolü verildi\n` +
          (nicknameChanged
            ? `▫️ Sunucu ismi **${isim}** olarak güncellendi`
            : `⚠️ Sunucu ismi güncellenemedi (bot yetkisi bu üye için yeterli değil)`)
      )
      .setFooter({ text: "Kayıt Sistemi" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("[kayit] kayıt işlenirken hata:", err);
    await interaction.editReply(`❌ Kayıt sırasında bir hata oluştu: ${(err as Error).message}`).catch(() => {});
  }
}
