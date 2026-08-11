import { ChatInputCommandInteraction, GuildMember, EmbedBuilder, Colors } from "discord.js";
import { memberHasAnyRoleId, ANALIZ_ROLE_IDS } from "../lib/permissions.js";
import { analyzeRoleText } from "../lib/ai-analiz.js";

export async function handleAnalizCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("roles" in member)) {
    await interaction.reply({ content: "❌ Bu komut sadece sunucu içinde kullanılabilir.", ephemeral: true });
    return;
  }

  if (!memberHasAnyRoleId(member as GuildMember, ANALIZ_ROLE_IDS)) {
    await interaction.reply({ content: "❌ Bu komutu kullanma yetkin yok.", ephemeral: true });
    return;
  }

  const metin = interaction.options.getString("metin", true);
  await interaction.deferReply();

  try {
    const analysis = await analyzeRoleText(metin);

    const lower = analysis.toLowerCase();
    let color: number = Colors.Blurple;
    if (lower.includes("reddediyorum") || lower.includes("reddet")) {
      color = Colors.Red;
    } else if (lower.includes("onaylıyorum") || lower.includes("onaylayalım") || lower.includes("onaylanabilir")) {
      color = Colors.Green;
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle("🤖 Rol Analizi")
      .setDescription(`> ${metin.length > 200 ? metin.slice(0, 200) + "…" : metin}\n\n${analysis}`)
      .setFooter({ text: "Bu bir yapay zeka önerisidir, son karar yetkiliye aittir." })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("[analiz] hata:", err);
    await interaction.editReply(`❌ Analiz yapılamadı: ${(err as Error).message}`);
  }
}
