import {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  Colors,
  GuildMember,
  Guild,
} from "discord.js";
import { STAFF_ROLE_NAME, memberHasRoleNamed, findRoleByName } from "../lib/permissions.js";

export const TICKET_SELECT_ID = "ticket_category_select";
export const TICKET_CLOSE_PREFIX = "ticket_close_";
const TICKET_CATEGORY_NAME = "Ticketler";

interface TicketCategoryOption {
  value: string;
  label: string;
  description: string;
  emoji: string;
}

// "Donate" ifadesi bilerek kaldırıldı — sadece "Satın Alımlar" olarak duruyor.
const TICKET_CATEGORIES: TicketCategoryOption[] = [
  {
    value: "destek_bug",
    label: "Destek, Bug & Teknik Sorunlar",
    description: "Teknik bir sorun mu yaşıyorsun?",
    emoji: "🛠️",
  },
  {
    value: "oyun_ici_sorun",
    label: "Oyun İçi Sorunlar & Rol Hataları",
    description: "Rol içi bir sorun bildir",
    emoji: "🎮",
  },
  {
    value: "diger_kategoriler",
    label: "Diğer Kategoriler",
    description: "Yukarıdakilere uymayan bir konu",
    emoji: "📁",
  },
  {
    value: "satin_alimlar",
    label: "Satın Alımlar",
    description: "Satın alım ile ilgili talebin",
    emoji: "💳",
  },
  {
    value: "pm_satin_alimlar",
    label: "PM Satın Alımlar",
    description: "Özel mesaj üzerinden satın alım",
    emoji: "📩",
  },
  {
    value: "ck_talep",
    label: "CK Talep",
    description: "Karakter kapatma (CK) talebi",
    emoji: "⚰️",
  },
  {
    value: "evren_onay",
    label: "Evren Onay",
    description: "Evren/hikaye onayı için başvur",
    emoji: "🌍",
  },
  {
    value: "yetkili_sikayet",
    label: "Yetkili Şikayet",
    description: "Bir yetkili hakkında şikayetin",
    emoji: "⚠️",
  },
];

export function buildTicketPanelMessage(guild: Guild) {
  const embed = new EmbedBuilder()
    .setColor(Colors.Purple)
    .setTitle(`🎫 ${guild.name} — Destek Merkezi`)
    .setDescription(
      "Aşağıdaki menüden talebine en uygun kategoriyi seç, senin için özel bir destek kanalı açılsın.\n\n" +
        "Açılan kanalı sadece **sen** ve **yetkili ekibimiz** görebilecek."
    )
    .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
    .setFooter({ text: `${guild.name} • Destek Sistemi`, iconURL: guild.iconURL() ?? undefined })
    .setTimestamp();

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(TICKET_SELECT_ID)
      .setPlaceholder("Ticket açmak için kategori seçiniz.")
      .addOptions(
        TICKET_CATEGORIES.map((cat) => ({
          value: cat.value,
          label: cat.label,
          description: cat.description,
          emoji: cat.emoji,
        }))
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

  if (!memberHasRoleNamed(executor as GuildMember, STAFF_ROLE_NAME)) {
    await interaction.reply({
      content: `❌ Bu komutu sadece **${STAFF_ROLE_NAME}** kullanabilir.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply(buildTicketPanelMessage(guild));
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

  const selectedValue = interaction.values[0];
  const category = TICKET_CATEGORIES.find((c) => c.value === selectedValue);
  if (!category) {
    await interaction.editReply("❌ Geçersiz kategori.");
    return;
  }

  const staffRole = findRoleByName(guild, STAFF_ROLE_NAME);

  // Aynı kişinin aynı kategori için zaten açık bir ticket'ı var mı kontrolü.
  await guild.channels.fetch();
  const existing = guild.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildText &&
      ch.name === `ticket-${interaction.user.username}`.toLowerCase().slice(0, 100)
  );
  if (existing) {
    await interaction.editReply(`❌ Zaten açık bir ticket'ın var: <#${existing.id}>`);
    return;
  }

  let ticketCategory = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase() === TICKET_CATEGORY_NAME.toLowerCase()
  );
  if (!ticketCategory) {
    try {
      ticketCategory = await guild.channels.create({
        name: TICKET_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
      });
    } catch (err) {
      await interaction.editReply(`❌ Ticket kategorisi oluşturulamadı: ${(err as Error).message}`);
      return;
    }
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
  if (staffRole) {
    overwrites.push({
      id: staffRole.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    });
  }

  let ticketChannel;
  try {
    ticketChannel = await guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: ticketCategory.id,
      permissionOverwrites: overwrites,
    });
  } catch (err) {
    await interaction.editReply(`❌ Ticket kanalı oluşturulamadı: ${(err as Error).message}`);
    return;
  }

  const welcomeEmbed = new EmbedBuilder()
    .setColor(Colors.Purple)
    .setTitle(`${category.emoji} Yeni Ticket — ${category.label}`)
    .setDescription(
      `Merhaba ${interaction.user}! Talebini buraya detaylıca yazabilirsin, ekibimiz en kısa sürede sana dönüş yapacak.\n\n` +
        `**Kategori:** ${category.label}`
    )
    .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
    .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined })
    .setTimestamp();

  const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_CLOSE_PREFIX}${interaction.user.id}`)
      .setLabel("🔒 Ticketi Kapat")
      .setStyle(ButtonStyle.Danger)
  );

  const mentionLine = staffRole
    ? `${interaction.user} | <@&${staffRole.id}>`
    : `${interaction.user}`;

  await ticketChannel.send({
    content: mentionLine,
    embeds: [welcomeEmbed],
    components: [closeRow],
    allowedMentions: { users: [interaction.user.id], roles: staffRole ? [staffRole.id] : [] },
  });

  await interaction.editReply(`✅ Ticket'ın oluşturuldu: <#${ticketChannel.id}>`);
}

export async function handleTicketCloseButton(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  const member = interaction.member;
  if (!guild || !member || !("roles" in member)) {
    await interaction.reply({ content: "❌ Bu işlem sadece sunucuda yapılabilir.", ephemeral: true });
    return;
  }

  const openedById = interaction.customId.slice(TICKET_CLOSE_PREFIX.length);
  const isOwner = interaction.user.id === openedById;
  const isStaff = memberHasRoleNamed(member as GuildMember, STAFF_ROLE_NAME);

  if (!isOwner && !isStaff) {
    await interaction.reply({
      content: `❌ Bu ticket'ı sadece açan kişi veya **${STAFF_ROLE_NAME}** kapatabilir.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply("🔒 Bu ticket 5 saniye içinde kapatılacak...");
  setTimeout(async () => {
    await interaction.channel?.delete().catch(() => {});
  }, 5000);
}
