import {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  PermissionsBitField,
  Colors,
  GuildMember,
  Guild,
} from "discord.js";
import {
  KURUCU_ROLE_NAME,
  TICKET_STAFF_ROLE_NAME,
  YONETIM_SEFI_ROLE_NAME,
  memberHasRoleNamed,
  findRoleByName,
} from "../lib/permissions.js";
import {
  incrementClosedTicket,
  getAllClosedTicketStats,
  resetClosedTicketStats,
} from "../lib/ticket-stats.js";
import { getAllRegistrationStats, resetRegistrationStats } from "../lib/registration-stats.js";

export const TICKET_SELECT_ID = "ticket_category_select";
export const TICKET_CLOSE_PREFIX = "ticket_close_";
export const TICKET_CLAIM_PREFIX = "ticket_claim_";
const TICKET_CATEGORY_NAME = "Ticketler";

interface TicketCategoryOption {
  value: string; // kanal isminde kullanılan kısa slug (harf/rakam/tire)
  label: string;
  description: string;
  emoji: string;
}

// "Donate" ifadesi bilerek kaldırıldı — sadece "Satın Alımlar" olarak duruyor.
const TICKET_CATEGORIES: TicketCategoryOption[] = [
  { value: "destek-bug", label: "Destek, Bug & Teknik Sorunlar", description: "Teknik bir sorun mu yaşıyorsun?", emoji: "🛠️" },
  { value: "oyun-ici-sorun", label: "Oyun İçi Sorunlar & Rol Hataları", description: "Rol içi bir sorun bildir", emoji: "🎮" },
  { value: "diger-kategoriler", label: "Diğer Kategoriler", description: "Yukarıdakilere uymayan bir konu", emoji: "📁" },
  { value: "satin-alimlar", label: "Satın Alımlar", description: "Satın alım ile ilgili talebin", emoji: "💳" },
  { value: "pm-satin-alimlar", label: "PM Satın Alımlar", description: "Özel mesaj üzerinden satın alım", emoji: "📩" },
  { value: "ck-talep", label: "CK Talep", description: "Karakter kapatma (CK) talebi", emoji: "⚰️" },
  { value: "evren-onay", label: "Evren Onay", description: "Evren/hikaye onayı için başvur", emoji: "🌍" },
  { value: "yetkili-sikayet", label: "Yetkili Şikayet", description: "Bir yetkili hakkında şikayetin", emoji: "⚠️" },
];

// key: channelId -> claimedByUserId (bot yeniden başlayınca sıfırlanır)
const ticketClaims = new Map<string, string>();

/** Discord kanal isimlerinde geçerli olmayan karakterleri temizler. */
function sanitizeForChannelName(input: string): string {
  return (
    input
      .toLocaleLowerCase("tr-TR")
      .replace(/[^a-z0-9çğıöşü_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "kullanici"
  );
}

export function buildTicketPanelMessage(guild: Guild, botAvatarURL: string | null) {
  const embed = new EmbedBuilder()
    .setColor(Colors.DarkAqua)
    .setAuthor({ name: guild.name, iconURL: botAvatarURL ?? undefined })
    .setTitle("🎫 Destek Merkezine Hoş Geldin")
    .setDescription(
      "Aşağıdaki menüden talebine en uygun kategoriyi seçerek sana özel bir destek kanalı açabilirsin.\n\n" +
        "▫️ Aynı anda sadece **1 açık ticket**'ın olabilir\n" +
        "▫️ Kanalı sadece **sen** ve **Ticket Yetkilisi** ekibimiz görebilir\n" +
        "▫️ İşin bitince ticket'ı kendin de kapatabilirsin"
    )
    .setImage(botAvatarURL)
    .setFooter({ text: "Destek Sistemi" })
    .setTimestamp();

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(TICKET_SELECT_ID)
      .setPlaceholder("🎫 Ticket kategorisini seç...")
      .addOptions(
        TICKET_CATEGORIES.map((cat) =>
          new StringSelectMenuOptionBuilder()
            .setValue(cat.value)
            .setLabel(cat.label)
            .setDescription(cat.description)
            .setEmoji(cat.emoji)
        )
      )
  );

  return { embeds: [embed], components: [selectRow] };
}

export async function handleTicketPanelCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guild = interaction.guild;
  const executor = interaction.member;
  if (!guild || !executor || !("roles" in executor)) {
    await interaction.reply({
      content: "❌ Bu komut sadece sunucu içinde kullanılabilir.",
      ephemeral: true,
    });
    return;
  }

  if (!memberHasRoleNamed(executor as GuildMember, KURUCU_ROLE_NAME)) {
    await interaction.reply({
      content: `❌ Bu komutu sadece **${KURUCU_ROLE_NAME}** kullanabilir.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply(
    buildTicketPanelMessage(guild, interaction.client.user?.displayAvatarURL({ size: 512 }) ?? null)
  );
}

export async function handleTicketCategorySelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "❌ Bu işlem sadece sunucuda yapılabilir.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const selectedValue = interaction.values[0];
    const category = TICKET_CATEGORIES.find((c) => c.value === selectedValue);
    if (!category) {
      await interaction.editReply("❌ Geçersiz kategori.");
      return;
    }

    const ticketStaffRole = findRoleByName(guild, TICKET_STAFF_ROLE_NAME);
    const safeUsername = sanitizeForChannelName(interaction.user.username);
    const channelName = `${category.value}-${safeUsername}`.slice(0, 100);

    await guild.channels.fetch();

    let ticketCategory = guild.channels.cache.find(
      (ch) =>
        ch.type === ChannelType.GuildCategory &&
        ch.name.toLowerCase() === TICKET_CATEGORY_NAME.toLowerCase()
    );
    if (!ticketCategory) {
      ticketCategory = await guild.channels.create({
        name: TICKET_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
      });
    }

    // Aynı kişinin, ticket kategorisi altında zaten açık bir kanalı var mı kontrolü.
    const existingInTicketCategory = guild.channels.cache.find(
      (ch) =>
        ch.type === ChannelType.GuildText &&
        ch.parentId === ticketCategory!.id &&
        ch.name.endsWith(`-${safeUsername}`)
    );
    if (existingInTicketCategory) {
      await interaction.editReply(`❌ Zaten açık bir ticket'ın var: <#${existingInTicketCategory.id}>`);
      return;
    }

    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
    ];
    if (ticketStaffRole) {
      overwrites.push({
        id: ticketStaffRole.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      });
    }
    // Botun kendisine de görünürlük vermezsek, kanal oluşuyor ama bot kendi
    // hoş geldin mesajını gönderemiyor ("Missing Access" hatası buradan geliyordu).
    const botUserId = interaction.client.user?.id;
    if (botUserId) {
      overwrites.push({
        id: botUserId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
        ],
      });
    }

    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: ticketCategory.id,
      permissionOverwrites: overwrites,
    });

    const welcomeEmbed = new EmbedBuilder()
      .setColor(Colors.DarkAqua)
      .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
      .setTitle(`${category.emoji} Yeni Ticket — ${category.label}`)
      .setDescription(
        `Merhaba ${interaction.user}! Talebini buraya detaylıca yazabilirsin, ekibimiz en kısa sürede sana dönüş yapacak.\n\n` +
          `**Kategori:** ${category.label}\n**Durum:** 🟡 Sahiplenilmedi`
      )
      .setThumbnail(interaction.client.user?.displayAvatarURL({ size: 256 }) ?? null)
      .setFooter({ text: "Destek Sistemi" })
      .setTimestamp();

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(TICKET_CLAIM_PREFIX)
        .setLabel("🙋 Sahiplen")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${TICKET_CLOSE_PREFIX}${interaction.user.id}`)
        .setLabel("🔒 Ticketi Kapat")
        .setStyle(ButtonStyle.Danger)
    );

    const mentionLine = ticketStaffRole
      ? `${interaction.user} | <@&${ticketStaffRole.id}>`
      : `${interaction.user}`;

    await ticketChannel.send({
      content: mentionLine,
      embeds: [welcomeEmbed],
      components: [actionRow],
      allowedMentions: { users: [interaction.user.id], roles: ticketStaffRole ? [ticketStaffRole.id] : [] },
    });

    await interaction.editReply(`✅ Ticket'ın oluşturuldu: <#${ticketChannel.id}>`);
  } catch (err) {
    console.error("[ticket] kategori seçimi işlenirken hata:", err);
    await interaction
      .editReply(`❌ Ticket oluşturulurken bir hata oluştu: ${(err as Error).message}`)
      .catch(() => {});
  }
}

export async function handleTicketClaimButton(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  const member = interaction.member;
  if (!guild || !member || !("roles" in member)) {
    await interaction.reply({ content: "❌ Bu işlem sadece sunucuda yapılabilir.", ephemeral: true });
    return;
  }

  if (!memberHasRoleNamed(member as GuildMember, TICKET_STAFF_ROLE_NAME)) {
    await interaction.reply({
      content: `❌ Bu ticket'ı sadece **${TICKET_STAFF_ROLE_NAME}** sahiplenebilir.`,
      ephemeral: true,
    });
    return;
  }

  const channelId = interaction.channelId;
  const existingClaim = ticketClaims.get(channelId);
  if (existingClaim) {
    if (existingClaim === interaction.user.id) {
      await interaction.reply({ content: "ℹ️ Bu ticket'ı zaten sen sahiplendin.", ephemeral: true });
      return;
    }
    await interaction.reply({
      content: `❌ Bu ticket zaten <@${existingClaim}> tarafından sahiplenilmiş.`,
      ephemeral: true,
    });
    return;
  }

  ticketClaims.set(channelId, interaction.user.id);

  const originalEmbed = interaction.message.embeds[0];
  const updatedEmbed = originalEmbed
    ? EmbedBuilder.from(originalEmbed).setDescription(
        (originalEmbed.description ?? "").replace(
          "**Durum:** 🟡 Sahiplenilmedi",
          `**Durum:** 🟢 Sahiplenildi (<@${interaction.user.id}>)`
        )
      )
    : new EmbedBuilder().setDescription(`Sahiplenen: <@${interaction.user.id}>`);

  const firstRow = interaction.message.components[0];
  const closeButton =
    firstRow && firstRow.type === ComponentType.ActionRow
      ? firstRow.components.find(
          (c) => c.type === ComponentType.Button && "customId" in c && c.customId?.startsWith(TICKET_CLOSE_PREFIX)
        )
      : undefined;
  const closeCustomId =
    closeButton && "customId" in closeButton && closeButton.customId
      ? closeButton.customId
      : `${TICKET_CLOSE_PREFIX}${interaction.user.id}`;

  const updatedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_CLAIM_PREFIX}claimed`)
      .setLabel(`🙋 Sahiplenildi: ${interaction.user.username}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder().setCustomId(closeCustomId).setLabel("🔒 Ticketi Kapat").setStyle(ButtonStyle.Danger)
  );

  await interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });
}

export async function handleTicketCloseButton(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  const member = interaction.member;
  if (!guild || !member || !("roles" in member)) {
    await interaction.reply({ content: "❌ Bu işlem sadece sunucuda yapılabilir.", ephemeral: true });
    return;
  }

  const isTicketStaff = memberHasRoleNamed(member as GuildMember, TICKET_STAFF_ROLE_NAME);

  if (!isTicketStaff) {
    await interaction.reply({
      content: `❌ Bu ticket'ı sadece **${TICKET_STAFF_ROLE_NAME}** kapatabilir.`,
      ephemeral: true,
    });
    return;
  }

  const claimedBy = ticketClaims.get(interaction.channelId);
  if (claimedBy && claimedBy !== interaction.user.id) {
    await interaction.reply({
      content: `❌ Bu ticket'ı sadece sahiplenen yetkili <@${claimedBy}> kapatabilir.`,
      ephemeral: true,
    });
    return;
  }

  ticketClaims.delete(interaction.channelId);
  incrementClosedTicket(interaction.user.id);

  await interaction.reply("🔒 Bu ticket 5 saniye içinde kapatılacak...");
  setTimeout(async () => {
    await interaction.channel?.delete().catch(() => {});
  }, 5000);
}

export async function handleTopAllCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("roles" in member)) {
    await interaction.reply({ content: "❌ Bu komut sadece sunucu içinde kullanılabilir.", ephemeral: true });
    return;
  }

  if (!memberHasRoleNamed(member as GuildMember, YONETIM_SEFI_ROLE_NAME)) {
    await interaction.reply({
      content: `❌ Bu komutu sadece **${YONETIM_SEFI_ROLE_NAME}** kullanabilir.`,
      ephemeral: true,
    });
    return;
  }

  const stats = getAllClosedTicketStats();
  const madalyalar = ["🥇", "🥈", "🥉"];

  const ticketEmbed = new EmbedBuilder()
    .setColor(Colors.DarkAqua)
    .setAuthor({
      name: interaction.guild?.name ?? "Destek Sistemi",
      iconURL: interaction.client.user?.displayAvatarURL({ size: 256 }) ?? undefined,
    })
    .setTitle("🎫 Ticket İstatistikleri")
    .setThumbnail(interaction.client.user?.displayAvatarURL({ size: 512 }) ?? null)
    .setTimestamp();

  if (stats.length === 0) {
    ticketEmbed.setDescription("Henüz kimse ticket kapatmamış.");
  } else {
    const toplam = stats.reduce((acc, s) => acc + s.count, 0);
    ticketEmbed.setDescription(
      stats
        .map((s, i) => {
          const sira = madalyalar[i] ?? `**${i + 1}.**`;
          return `${sira}  <@${s.userId}> — **${s.count}** ticket`;
        })
        .join("\n")
    );
    ticketEmbed.addFields({ name: "Toplam Kapatılan", value: `**${toplam}** ticket`, inline: true });
  }
  ticketEmbed.setFooter({ text: "Destek Sistemi" });

  const regStats = getAllRegistrationStats();
  const kayitEmbed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle("📋 Kayıt İstatistikleri")
    .setTimestamp();

  if (regStats.length === 0) {
    kayitEmbed.setDescription("Henüz kimse kayıt yapmamış.");
  } else {
    const toplamKayit = regStats.reduce((acc, s) => acc + s.count, 0);
    kayitEmbed.setDescription(
      regStats
        .map((s, i) => {
          const sira = madalyalar[i] ?? `**${i + 1}.**`;
          return `${sira}  <@${s.userId}> — **${s.count}** kayıt`;
        })
        .join("\n")
    );
    kayitEmbed.addFields({ name: "Toplam Kayıt", value: `**${toplamKayit}** kayıt`, inline: true });
  }
  kayitEmbed.setFooter({ text: "Kayıt Sistemi" });

  await interaction.reply({ embeds: [ticketEmbed, kayitEmbed] });
}

export async function handleTopResetCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("roles" in member)) {
    await interaction.reply({ content: "❌ Bu komut sadece sunucu içinde kullanılabilir.", ephemeral: true });
    return;
  }

  if (!memberHasRoleNamed(member as GuildMember, YONETIM_SEFI_ROLE_NAME)) {
    await interaction.reply({
      content: `❌ Bu komutu sadece **${YONETIM_SEFI_ROLE_NAME}** kullanabilir.`,
      ephemeral: true,
    });
    return;
  }

  resetClosedTicketStats();
  resetRegistrationStats();
  await interaction.reply("✅ Tüm ticket ve kayıt istatistikleri sıfırlandı.");
}
