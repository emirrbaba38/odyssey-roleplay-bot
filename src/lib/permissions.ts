import { ChannelType, Guild, GuildMember, TextChannel } from "discord.js";

export function findRoleByName(guild: Guild, name: string) {
  return guild.roles.cache.find(
    (role) => role.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
}

export function memberHasRoleNamed(member: GuildMember, name: string): boolean {
  return member.roles.cache.some(
    (role) => role.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
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
