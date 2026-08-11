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

  const hikayeMetin = interaction.options.getString("hikaye");
  const dosya = interaction.options.getAttachment("dosya");

  if (!hikayeMetin && !dosya) {
    await interaction.reply({
      content: "❌ Ya `hikaye` metnini yaz ya da `dosya` olarak bir .txt dosyası yükle.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    let hikaye = hikayeMetin ?? "";

    // Uzun hikayeler için .txt dosyası desteği — Discord'un mesaj/komut karakter
    // limitine takılmadan tüm metni okuyabiliriz.
    if (dosya) {
      if (!dosya.name.toLowerCase().endsWith(".txt") && !dosya.contentType?.startsWith("text/")) {
        await interaction.editReply("❌ Sadece `.txt` dosyaları desteklenir.");
        return;
      }
      const res = await fetch(dosya.url);
      if (!res.ok) {
        await interaction.editReply("❌ Dosya indirilemedi, tekrar dener misin?");
        return;
      }
      const dosyaIcerik = await res.text();
      hikaye = [hikaye, dosyaIcerik].filter(Boolean).join("\n\n").trim();
    }

    if (!hikaye) {
      await interaction.editReply("❌ Dosya boş görünüyor.");
      return;
    }

    const analysis = await analyzeCharacterBackstory(hikaye);

    const lower = analysis.toLowerCase();
    let color: number = Colors.Blurple;
    if (lower.includes("reddediyorum") || lower.includes("reddet")) {
      color = Colors.Red;
    } else if (lower.includes("onaylıyorum") || lower.includes("onaylayalım") || lower.includes("onaylanabilir")) {
      color = Colors.Green;
    }

    const onizleme = hikaye.length > 200 ? hikaye.slice(0, 200) + "…" : hikaye;
    const description = `> ${onizleme}\n\n${analysis}`.slice(0, 4000);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle("📖 Karakter Hikayesi Analizi")
      .setDescription(description)
      .setFooter({ text: "Bu bir yapay zeka önerisidir, son karar yetkiliye aittir." })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("[hikayeanaliz] hata:", err);
    await interaction.editReply(`❌ Analiz yapılamadı: ${(err as Error).message}`);
  }
}
