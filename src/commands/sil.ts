import { ChatInputCommandInteraction, GuildMember, TextChannel } from "discord.js";
import { memberHasRoleId, KURUCU_ROLE_ID, YETKILI_EKIBI_ROLE_ID } from "../lib/permissions.js";

// Discord'un tek seferde bulk delete ile silebildiği maksimum mesaj sayısı.
const MAX_BULK_DELETE = 100;

export async function handleSilCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  const executor = interaction.member;

  if (!guild || !executor || !("roles" in executor)) {
    await interaction.reply({
      content: "❌ Bu komut sadece sunucu içinde kullanılabilir.",
      ephemeral: true,
    });
    return;
  }

  const yetkili =
    memberHasRoleId(executor as GuildMember, KURUCU_ROLE_ID) ||
    memberHasRoleId(executor as GuildMember, YETKILI_EKIBI_ROLE_ID);

  if (!yetkili) {
    await interaction.reply({
      content: "❌ Bu komutu kullanmaya yetkin yok.",
      ephemeral: true,
    });
    return;
  }

  const sayi = interaction.options.getInteger("sayı", true);

  if (sayi < 1 || sayi > MAX_BULK_DELETE) {
    await interaction.reply({
      content: `❌ Sayı 1 ile ${MAX_BULK_DELETE} arasında olmalı.`,
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || !("bulkDelete" in channel)) {
    await interaction.reply({
      content: "❌ Bu kanalda mesaj silinemiyor.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const deleted = await (channel as TextChannel).bulkDelete(sayi, true);
    await interaction.editReply(`✅ ${deleted.size} mesaj silindi.`);
  } catch (err) {
    console.error("[sil] Mesajlar silinemedi:", err);
    await interaction.editReply(
      "❌ Mesajlar silinemedi (14 günden eski mesajlar toplu silinemez ya da bir hata oluştu)."
    );
  }
}
