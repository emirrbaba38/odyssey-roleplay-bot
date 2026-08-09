import { Client, GuildMember } from "discord.js";
import { NEW_PLAYER_ROLE_NAME, findRoleByName } from "../lib/permissions.js";

export function registerAutoRole(client: Client): void {
  client.on("guildMemberAdd", async (member: GuildMember) => {
    try {
      const guild = member.guild;
      const role = findRoleByName(guild, NEW_PLAYER_ROLE_NAME);
      if (!role) {
        console.warn(
          `[oto-rol] "${NEW_PLAYER_ROLE_NAME}" rolü bulunamadı, ${member.user.tag} adlı üyeye rol verilemedi. Bu isimde bir rol oluşturduğundan emin ol.`
        );
        return;
      }
      await member.roles.add(role);
      console.log(`[oto-rol] ${member.user.tag} kullanıcısına "${NEW_PLAYER_ROLE_NAME}" rolü verildi.`);
    } catch (err) {
      console.error("[oto-rol] Rol verilemedi:", err);
    }
  });
}
