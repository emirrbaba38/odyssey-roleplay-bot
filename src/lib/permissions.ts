import { ChannelType, Guild, GuildMember, TextChannel } from "discord.js";

export const STAFF_ROLE_NAME = "Yetkili";
export const WHITELIST_ROLE_NAME = "Whitelist";
export const NEW_PLAYER_ROLE_NAME = "✖️・Yeni Oyuncu";

// Bu roller artık isim yerine ID ile eşleştiriliyor (rol adı değişse bile bozulmaz,
// aynı isimde sahte bir rol oluşturularak atlatılamaz).
export const KURUCU_ROLE_ID = "1535212989370867743";
export const YONETIM_SEFI_ROLE_ID = "1535212991585194025";
export const YETKILI_EKIBI_ROLE_ID = "1535213004252258394";
export const TICKET_STAFF_ROLE_ID = "1535955544190488586";

// /analiz ve /hikayeanaliz komutlarını kullanabilecek roller (birden fazla rol ID'si).
export const ANALIZ_ROLE_IDS = [
  "1535212992591822919",
  "1535212989370867743",
  "1535212990713040939",
  "1535212994571669575",
  "1535212991585194025",
  "1535212993636466688",
];

// /topall komutunu kullanabilecek roller (birden fazla rol ID'si).
export const TOPALL_ROLE_IDS = [
  "1535212994571669575",
  "1535212990713040939",
  "1535212989370867743",
  "1535212993636466688",
];

// "Satın Alımlar", "PM Satın Alımlar" ve "Yetkili Şikayet" ticket kategorilerini
// SADECE bu roller görebilir — Ticket Yetkilisi rolü bu 3 kategoride görmez.
export const HASSAS_TICKET_ROLE_IDS = [
  "1535212986535256156",
  "1535212989370867743",
  "1535212990713040939",
  "1535212991585194025",
  "1535212992591822919",
  "1535212994571669575",
];

// Hata mesajlarında gösterilecek okunabilir isimler (yetki kontrolü için kullanılmıyor)
export const KURUCU_ROLE_NAME = "🔱・Kurucu";
export const TICKET_STAFF_ROLE_NAME = "Ticket Yetkilisi";
export const YONETIM_SEFI_ROLE_NAME = "🔷・Yönetim Şefi";
export const YETKILI_EKIBI_ROLE_NAME = "Yetkili Ekibi";

export function findRoleByName(guild: Guild, name: string) {
  return guild.roles.cache.find(
    (role) => role.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
}

export function findRoleById(guild: Guild, roleId: string) {
  return guild.roles.cache.get(roleId);
}

export function memberHasRoleNamed(member: GuildMember, name: string): boolean {
  return member.roles.cache.some(
    (role) => role.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
}

export function memberHasRoleId(member: GuildMember, roleId: string): boolean {
  return member.roles.cache.has(roleId);
}

export function memberHasAnyRoleId(member: GuildMember, roleIds: string[]): boolean {
  return roleIds.some((id) => member.roles.cache.has(id));
}

export async function findTextChannelByName(
  guild: Guild,
  name: string
): Promise<TextChannel | undefined> {
  await guild.channels.fetch().catch(() => {});
  return guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText && ch.name.toLowerCase() === name.toLowerCase()
  ) as TextChannel | undefined;
}
