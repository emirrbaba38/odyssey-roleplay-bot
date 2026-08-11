import { ChatInputCommandInteraction, GuildMember, EmbedBuilder, Colors } from "discord.js";
import { memberHasAnyRoleId, ANALIZ_ROLE_IDS } from "../lib/permissions.js";
import { analyzeCharacterBackstory } from "../lib/ai-hikaye-analiz.js";

export async function handleHikayeAnalizCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("roles" in member)) {
    await interaction.reply({ content: "❌ Bu komut sadece sunucu içinde kullanılabilir.", ephemeral: true });
    return;
  }

  if (!memberHasAnyRoleId(member as GuildMember, ANALIZ_ROLE_IDS)) {
    await interaction.reply({ content: "❌ Bu komutu kullanma yetkin yok.", ephemeral: true });
    return;
  }

  const hikaye = interaction.options.getString("hikaye", true);
  await interaction.deferReply();

  try {
    const analysis = await analyzeCharacterBackstory(hikaye);

    const lower = analysis.toLowerCase();
    let color: number = Colors.Blurple;
    if (lower.includes("reddediyorum") || lower.includes("reddet")) {
      color = Colors.Red;
    } else if (lower.includes("onaylıyorum") || lower.includes("onaylayalım") || lower.includes("onaylanabilir")) {
      color = Colors.Green;
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle("📖 Karakter Hikayesi Analizi")
      .setDescription(`> ${hikaye.length > 200 ? hikaye.slice(0, 200) + "…" : hikaye}\n\n${analysis}`)
      .setFooter({ text: "Bu bir yapay zeka önerisidir, son karar yetkiliye aittir." })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("[hikayeanaliz] hata:", err);
    await interaction.editReply(`❌ Analiz yapılamadı: ${(err as Error).message}`);
  }
}
