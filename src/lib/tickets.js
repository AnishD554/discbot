import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from "discord.js";

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
}

export function buildTicketPanelPayload({
  title = "Support Tickets",
  description = "Press the button below to create a private support ticket."
} = {}) {
  const embed = new EmbedBuilder()
    .setTitle(`🎫 ${title}`)
    .setDescription(description)
    .setColor(0x5865f2)
    .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket:create")
      .setLabel("Create Ticket")
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

export function buildTicketExamPromptPayload(exams) {
  const embed = new EmbedBuilder()
    .setTitle("🎫 Choose Ticket Exam")
    .setDescription("Select the exam this ticket is for, or choose Other.")
    .setColor(0x5865f2)
    .setTimestamp(new Date());

  const options = exams.slice(0, 24).map((exam) => ({
    label: exam.length > 100 ? exam.slice(0, 97) : exam,
    value: exam
  }));
  options.push({
    label: "Other",
    value: "__other__"
  });

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ticket-exam-select")
      .setPlaceholder("Select an exam")
      .addOptions(options)
  );

  return {
    embeds: [embed],
    components: [row],
    ephemeral: true
  };
}

export function buildTicketChannelPayload(ticket) {
  const embed = new EmbedBuilder()
    .setTitle(`🎫 Ticket ${ticket.id}`)
    .setDescription(
      [
        `**Opened by:** <@${ticket.ownerId}>`,
        ticket.claimedBy ? `**Claimed by:** <@${ticket.claimedBy}>` : "**Claimed by:** Nobody yet",
        ticket.exam ? `**Exam:** ${ticket.exam}` : null,
        ticket.note ? `**Details:** ${ticket.note}` : null
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setColor(0x57f287)
    .setTimestamp(new Date(ticket.createdAt));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket-close:${ticket.id}`)
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger)
  );

  return {
    content: `<@${ticket.ownerId}>`,
    embeds: [embed],
    components: [row]
  };
}

export function buildTicketClosedPayload(ticket) {
  const embed = new EmbedBuilder()
    .setTitle(`🔒 Ticket Closed`)
    .setDescription(
      [
        `**Ticket ID:** ${ticket.id}`,
        `**Opened by:** <@${ticket.ownerId}>`,
        ticket.claimedBy ? `**Claimed by:** <@${ticket.claimedBy}>` : null,
        ticket.closedBy ? `**Closed by:** <@${ticket.closedBy}>` : null,
        ticket.closeReason ? `**Reason:** ${ticket.closeReason}` : null
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setColor(0xed4245)
    .setTimestamp(new Date(ticket.updatedAt));

  return {
    embeds: [embed],
    components: []
  };
}

export function buildTicketPermissions({ guild, ownerId, supportRoleIds }) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: ownerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    }
  ];

  for (const roleId of supportRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
      ]
    });
  }

  return overwrites;
}

export async function createTicketChannel({
  guild,
  config,
  owner,
  sequence,
  exam,
  note
}) {
  const examSlug = slugify(exam || "other");
  const userSlug = slugify(owner.username ?? owner.globalName ?? "user");
  const channelName = `ticket-${examSlug}-${userSlug}`.slice(0, 100);
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId || null,
    permissionOverwrites: buildTicketPermissions({
      guild,
      ownerId: owner.id,
      supportRoleIds: config.ticketSupportRoleIds
    })
  });

  const ticket = {
    id: `TICKET-${sequence.toString().padStart(4, "0")}`,
    channelId: channel.id,
    guildId: guild.id,
    ownerId: owner.id,
    ownerTag: owner.tag ?? owner.username,
    exam: exam ?? "",
    note: note ?? "",
    claimedBy: null,
    closedBy: null,
    closeReason: "",
    status: "open",
    participants: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  await channel.send(buildTicketChannelPayload(ticket));
  return { channel, ticket };
}
