import { Message, MessageOptions, NewsChannel, TextChannel, VoiceChannel } from "discord.js";
import { DisplayChannel } from "../Interfaces";
import { Base } from "../Base";
import { MessagingUtils } from "../MessagingUtils";
import { SchedulingUtils } from "../SchedulingUtils";

export class DisplayChannelTable {
   /**
    * Create & update DisplayChannel database table if necessary
    */
   public static initTable(): void {
      Base.getKnex()
         .schema.hasTable("display_channels")
         .then(async (exists) => {
            if (!exists) {
               await Base.getKnex()
                  .schema.createTable("display_channels", (table) => {
                     table.increments("id").primary();
                     table.text("queue_channel_id");
                     table.text("display_channel_id");
                     table.text("embed_id");
                  })
                  .catch((e) => console.error(e));
            }
         });

      this.updateTableStructure();
   }

   /**
    *
    * @param queueChannel
    * @param displayChannel
    * @param msgEmbed
    */
   public static async storeDisplayChannel(
      queueChannel: VoiceChannel | TextChannel | NewsChannel,
      displayChannel: TextChannel | NewsChannel,
      displayEmbed: MessageOptions
   ): Promise<Message> {
      const displayPermissions = displayChannel.permissionsFor(displayChannel.guild.me);
      if (displayPermissions.has("SEND_MESSAGES") && displayPermissions.has("EMBED_LINKS")) {
         const response = (await displayChannel.send(displayEmbed).catch()) as Message;
         if (response) {
            if (queueChannel.type === "text") {
               MessagingUtils.sendReaction(response, Base.getConfig().joinEmoji);
            }
            await Base.getKnex()<DisplayChannel>("display_channels").insert({
               display_channel_id: displayChannel.id,
               embed_id: response.id,
               queue_channel_id: queueChannel.id,
            });
         }
         return response;
      }
   }

   /**
    *
    * @param queueChannelId
    * @param displayChannelIdToRemove
    * @param deleteOldDisplayMsg
    */
   public static async unstoreDisplayChannel(
      queueChannelId: string,
      displayChannelIdToRemove?: string,
      deleteOldDisplayMsg = true
   ): Promise<void> {
      let storedDisplayChannels: DisplayChannel[];

      // Retreive list of stored embeds for display channel
      if (displayChannelIdToRemove) {
         storedDisplayChannels = await Base.getKnex()<DisplayChannel>("display_channels")
            .where("queue_channel_id", queueChannelId)
            .where("display_channel_id", displayChannelIdToRemove);
         await Base.getKnex()<DisplayChannel>("display_channels")
            .where("queue_channel_id", queueChannelId)
            .where("display_channel_id", displayChannelIdToRemove)
            .del();
      } else {
         storedDisplayChannels = await Base.getKnex()<DisplayChannel>("display_channels").where("queue_channel_id", queueChannelId);
         await Base.getKnex()<DisplayChannel>("display_channels").where("queue_channel_id", queueChannelId).del();
      }
      if (!storedDisplayChannels) return;

      // If found, delete them from discord
      for (const storedDisplayChannel of storedDisplayChannels) {
         try {
            const displayChannel = (await Base.getClient().channels.fetch(storedDisplayChannel.display_channel_id)) as
               | TextChannel
               | NewsChannel;
            const displayMessage = await displayChannel.messages.fetch(storedDisplayChannel.embed_id, false);
            if (deleteOldDisplayMsg) {
               await displayMessage.delete().catch(() => null);
            } else {
               if (displayChannel.permissionsFor(displayChannel.guild.me).has("MANAGE_MESSAGES")) {
                  setTimeout(() => displayMessage.reactions.removeAll().catch(() => null), 1000); // Timeout to avoid rate limit
               } else {
                  SchedulingUtils.scheduleResponseToChannel(
                     "I can clean up old queue reactions, but I need a new permission.\n" +
                        "I can be given permission in `Server Settings` > `Roles` > `Queue Bot` > enable `Manage Messages`.",
                     displayChannel
                  );
               }
            }
         } catch (e) {
            // EMPTY
         }
      }
   }

   /**
    * Modify the database structure for code patches
    */
   protected static async updateTableStructure(): Promise<void> {
      // Migration of embed_ids to embed_id
      if (await Base.getKnex().schema.hasColumn("display_channels", "embed_ids")) {
         console.log("Migrating display embed ids");
         await Base.getKnex().schema.table("display_channels", (table) => table.text("embed_id"));
         (await Base.getKnex()<DisplayChannel>("display_channels")).forEach(async (displayChannel) => {
            await Base.getKnex()<DisplayChannel>("display_channels")
               .where("queue_channel_id", displayChannel.queue_channel_id)
               .where("display_channel_id", displayChannel.display_channel_id)
               .update("embed_id", displayChannel["embed_ids"][0]);
         });
         await Base.getKnex().schema.table("display_channels", (table) => table.dropColumn("embed_ids"));
      }
   }
}
