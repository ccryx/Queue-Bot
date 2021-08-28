import { Guild, Snowflake, StageChannel, TextChannel, VoiceChannel } from "discord.js";
import { AdminPermissionTable } from "./tables/AdminPermissionTable";
import { PriorityTable } from "./tables/PriorityTable";
import { QueueChannelTable } from "./tables/QueueChannelTable";
import { QueueGuildTable } from "./tables/QueueGuildTable";
import delay from "delay";

export class Validator {
   private static timestampCache = new Map<Snowflake, number>(); // <guild.id, timestamp>
   private static HALF_HOUR = 1000 * 60 * 60;

   public static async validateGuild(guild: Guild): Promise<void> {
      const cachedTime = this.timestampCache.get(guild.id);
      const now = Date.now();
      if (cachedTime && now - cachedTime < Validator.HALF_HOUR) return; // Limit validation to once every half hour
      this.timestampCache.set(guild.id, now);
      try {
         // Force fetch server data
         // (Clear potentially delete data)
         guild.channels.cache.clear();
         guild.members.cache.clear();
         guild.roles.cache.clear();
         const channels = Array.from((await guild.channels.fetch()).values()) as (
            | TextChannel
            | VoiceChannel
            | StageChannel
         )[];
         const members = Array.from((await guild.members.fetch()).values());
         const roles = Array.from((await guild.roles.fetch()).values());
         // Clear cached data - the validate methods below will handle caching
         guild.channels.cache.clear();
         guild.members.cache.clear();
         guild.roles.cache.clear();

         const queueGuild = await QueueGuildTable.get(guild.id);
         // Verify that stored data is contained within server data
         AdminPermissionTable.validate(guild, members, roles);
         const requireUpdate = await PriorityTable.validate(guild, members, roles);
         QueueChannelTable.validate(requireUpdate, queueGuild, guild, channels, members, roles);
      } catch (e) {
         // Nothing - we don't want to accidentally delete legit data
      }
   }

   public static async validateAtStartup(guilds: Guild[]): Promise<void> {
      for await (const guild of guilds) {
         this.validateGuild(guild);
         await delay(400);
      }
   }
}
