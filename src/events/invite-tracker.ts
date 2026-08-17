import { Client, Events, GuildMember, EmbedBuilder, Colors } from "discord.js";
import { findTextChannelByName } from "../lib/permissions.js";

const KATILIM_LOG_KANAL = "gelen-giden";
const HOSGELDIN_GIF_URL =
  "https://cdn.discordapp.com/attachments/1348342995321356348/1535948198710087711/gorselde_ki_ates_yansn_boyle.gif";
// Şimdilik hoşgeldin ile aynı gif kullanılıyor — istenirse ayrı bir "hoşça kal" gifi ile değiştirilebilir.
const GULE_GULE_GIF_URL = HOSGELDIN_GIF_URL;

function formatTarih(date: Date): string {
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
}

export function registerInviteTracker(client: Client): void {
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      const guild = member.guild;

      const hesapAcilmaTarihi = formatTarih(member.user.createdAt);
      const katilmaTarihi = formatTarih(member.joinedAt ?? new Date());

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setAuthor({
          name: guild.name,
          iconURL: client.user?.displayAvatarURL({ size: 256 }) ?? undefined,
        })
        .setTitle("📥 Yeni Üye Katıldı")
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setDescription(
          `**Katılan:** ${member}\n` +
            `**Hesap Açılma Tarihi:** ${hesapAcilmaTarihi}\n` +
            `**Sunucuya Katılma Tarihi:** ${katilmaTarihi}`
        )
        .setImage(HOSGELDIN_GIF_URL)
        .setFooter({ text: "Katılım Sistemi" })
        .setTimestamp();

      const logKanal = await findTextChannelByName(guild, KATILIM_LOG_KANAL);
      if (!logKanal) {
        console.warn(
          `[katilim] "${KATILIM_LOG_KANAL}" adında bir kanal bulunamadı, katılım paneli gönderilemedi.`
        );
        return;
      }

      await logKanal.send({
        content: `${member}`,
        embeds: [embed],
        allowedMentions: { users: [member.id] },
      });
    } catch (err) {
      console.error("[katilim] üye katılımı işlenirken hata:", err);
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      const guild = member.guild;

      const hesapAcilmaTarihi = formatTarih(member.user.createdAt);
      const katilmaTarihi = member.joinedAt ? formatTarih(member.joinedAt) : "Bilinmiyor";

      const embed = new EmbedBuilder()
        .setColor(Colors.DarkGrey)
        .setAuthor({
          name: guild.name,
          iconURL: client.user?.displayAvatarURL({ size: 256 }) ?? undefined,
        })
        .setTitle("📤 Üye Ayrıldı")
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setDescription(
          `**Ayrılan:** ${member.user.tag}\n` +
            `**Hesap Açılma Tarihi:** ${hesapAcilmaTarihi}\n` +
            `**Sunucuya Katılma Tarihi:** ${katilmaTarihi}\n\n` +
            `Hoşça kal, seni bekliyor olacağız! 👋`
        )
        .setImage(GULE_GULE_GIF_URL)
        .setFooter({ text: "Katılım Sistemi" })
        .setTimestamp();

      const logKanal = await findTextChannelByName(guild, KATILIM_LOG_KANAL);
      if (!logKanal) {
        console.warn(
          `[ayrilma] "${KATILIM_LOG_KANAL}" adında bir kanal bulunamadı, ayrılma paneli gönderilemedi.`
        );
        return;
      }

      await logKanal.send({ embeds: [embed] });
    } catch (err) {
      console.error("[ayrilma] üye ayrılması işlenirken hata:", err);
    }
  });
}
