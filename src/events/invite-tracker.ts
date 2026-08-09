import { Client, Events, GuildMember, EmbedBuilder, Colors, Collection, Invite } from "discord.js";
import { findTextChannelByName } from "../lib/permissions.js";

const KATILIM_LOG_KANAL = "gelen-giden";
const HOSGELDIN_GIF_URL =
  "https://cdn.discordapp.com/attachments/1348342995321356348/1535948198710087711/gorselde_ki_ates_yansn_boyle.gif";

// guildId -> (inviteCode -> uses)
const inviteUsesCache = new Map<string, Map<string, number>>();

async function cacheGuildInvites(guild: import("discord.js").Guild): Promise<void> {
  try {
    const invites = await guild.invites.fetch();
    const usesMap = new Map<string, number>();
    invites.forEach((invite) => usesMap.set(invite.code, invite.uses ?? 0));
    inviteUsesCache.set(guild.id, usesMap);
  } catch (err) {
    console.error(`[davet-takip] "${guild.name}" davetleri önbelleğe alınamadı (bot'ta "Sunucuyu Yönet" izni var mı?):`, err);
  }
}

function formatTarih(date: Date): string {
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
}

export function registerInviteTracker(client: Client): void {
  client.once(Events.ClientReady, async (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      await cacheGuildInvites(guild);
    }
  });

  client.on(Events.InviteCreate, async (invite) => {
    if (!invite.guild) return;
    const usesMap = inviteUsesCache.get(invite.guild.id) ?? new Map<string, number>();
    usesMap.set(invite.code, invite.uses ?? 0);
    inviteUsesCache.set(invite.guild.id, usesMap);
  });

  client.on(Events.InviteDelete, (invite) => {
    if (!invite.guild) return;
    const usesMap = inviteUsesCache.get(invite.guild.id);
    usesMap?.delete(invite.code);
  });

  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      const guild = member.guild;
      const oncekiKullanim = inviteUsesCache.get(guild.id) ?? new Map<string, number>();

      let yeniDavetler: Collection<string, Invite>;
      try {
        yeniDavetler = await guild.invites.fetch();
      } catch (err) {
        console.error("[davet-takip] güncel davetler çekilemedi:", err);
        return;
      }

      const kullanilanDavet = yeniDavetler.find(
        (invite) => (invite.uses ?? 0) > (oncekiKullanim.get(invite.code) ?? 0)
      );

      const yeniKullanimMap = new Map<string, number>();
      yeniDavetler.forEach((invite) => yeniKullanimMap.set(invite.code, invite.uses ?? 0));
      inviteUsesCache.set(guild.id, yeniKullanimMap);

      const davetEdenText = kullanilanDavet?.inviter
        ? `<@${kullanilanDavet.inviter.id}>`
        : "Bilinmiyor (vanity link veya takip edilemeyen davet)";

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
          `**Davet Eden:** ${davetEdenText}\n` +
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
          `[davet-takip] "${KATILIM_LOG_KANAL}" adında bir kanal bulunamadı, katılım paneli gönderilemedi.`
        );
        return;
      }

      await logKanal.send({ embeds: [embed] });
    } catch (err) {
      console.error("[davet-takip] üye katılımı işlenirken hata:", err);
    }
  });
}
