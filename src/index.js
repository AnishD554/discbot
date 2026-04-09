import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits
} from "discord.js";
import fs from "node:fs";
import { ActionRowBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { formatUnits, parseUnits } from "ethers";
import { config, validateConfig } from "./config.js";
import { buildInvoice } from "./lib/invoices.js";
import { fetchUsdQuotes, formatUsd } from "./lib/pricing.js";
import {
  buildPaidAnnouncementMessage,
  buildChosenPaymentMessage,
  buildPaidMessage,
  buildPaymentSelectionMessage
} from "./lib/render.js";
import { JsonStore } from "./lib/store.js";
import {
  buildTicketChannelPayload,
  buildTicketClosedPayload,
  buildTicketExamPromptPayload,
  buildTicketPanelPayload,
  createTicketChannel
} from "./lib/tickets.js";
import { PaymentWatcher } from "./lib/watcher.js";
import { watermarkPdf } from "./lib/watermark.js";

validateConfig();

const store = new JsonStore();
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function getMethodConfig(methodId) {
  return config.paymentMethods.find((entry) => entry.id === methodId) ?? null;
}

function examSuggestions(query) {
  const exams = store.getExams();
  if (!query) {
    return exams.slice(0, 25);
  }

  const lowered = query.toLowerCase();
  return exams
    .filter((exam) => exam.toLowerCase().includes(lowered))
    .slice(0, 25);
}

function isSupportMember(member) {
  if (!member) {
    return false;
  }

  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return true;
  }

  return config.ticketSupportRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function ensureExamExists(exam) {
  return store.getExams().some((entry) => entry.toLowerCase() === exam.toLowerCase());
}

function isAllowedUser(userId) {
  return config.allowedUserIds.includes(userId);
}

async function downloadAttachment(attachment) {
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Failed to download attachment: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function loadDefaultOverlay(pathname) {
  if (!pathname || !fs.existsSync(pathname)) {
    return null;
  }

  const bytes = fs.readFileSync(pathname);
  const lower = pathname.toLowerCase();
  const contentType = lower.endsWith(".jpg") || lower.endsWith(".jpeg")
    ? "image/jpeg"
    : "image/png";

  return {
    bytes,
    contentType,
    name: pathname.split("/").pop() ?? "overlay.png"
  };
}

function updatePendingQuote(method, methodConfig, usdAmount, quotes) {
  const usdPerCoin = Number(quotes[methodConfig.coingeckoId].usd);
  const exactAmount = usdAmount / usdPerCoin;
  const displayAmount = exactAmount
    .toFixed(methodConfig.quoteDecimals ?? 8)
    .replace(/\.?0+$/, "");
  const atomicString = parseUnits(displayAmount, methodConfig.decimals).toString();

  method.usdPerCoin = usdPerCoin;
  method.displayAmount = displayAmount;
  method.expectedAtomic = atomicString;
  method.minAtomic = ((BigInt(atomicString) * 99n) / 100n).toString();
}

async function createInvoiceForInteraction(interaction) {
  const quotes = await fetchUsdQuotes(config);
  const exam = interaction.options.getString("exam", true);
  const customer = interaction.options.getUser("customer", true);
  const invoice = buildInvoice({
    config,
    store,
    user: customer,
    guildId: interaction.guildId,
    usdAmount: interaction.options.getNumber("amount", true),
    exam,
    note: interaction.options.getString("note"),
    quotes
  });

  return store.createInvoice(invoice);
}

async function refreshInvoice(invoiceId) {
  const quotes = await fetchUsdQuotes(config);
  return store.updateInvoice(invoiceId, (draft) => {
    for (const method of draft.methods) {
      if (method.status !== "pending") {
        continue;
      }

      const methodConfig = getMethodConfig(method.methodId);
      updatePendingQuote(method, methodConfig, Number(draft.usdAmount), quotes);
    }

    draft.updatedAt = new Date().toISOString();
    return draft;
  });
}

async function renderInvoiceMessage(invoice) {
  const channel = await client.channels.fetch(invoice.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return;
  }

  const message = await channel.messages.fetch(invoice.messageId).catch(() => null);
  if (!message) {
    return;
  }

  const payload =
    invoice.status === "paid"
      ? buildChosenPaymentMessage(invoice)
      : invoice.selectedMethodId
        ? buildChosenPaymentMessage(invoice)
        : buildPaymentSelectionMessage(invoice);

  await message.edit(payload).catch((error) => {
    console.error(`Failed to edit invoice message ${invoice.messageId}:`, error);
  });
}

async function sendPaidAnnouncement(invoice) {
  if (invoice.paidAnnouncementSentAt) {
    return;
  }

  const channel = await client.channels.fetch(invoice.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return;
  }

  await channel.send(buildPaidAnnouncementMessage(invoice, config.paidMentionId)).catch((error) => {
    console.error(`Failed to send paid announcement for ${invoice.id}:`, error);
  });

  store.updateInvoice(invoice.id, (draft) => {
    draft.paidAnnouncementSentAt = new Date().toISOString();
    draft.updatedAt = new Date().toISOString();
    return draft;
  });
}

async function createNewTicket({ interaction, owner, exam = "", note = "" }) {
  const guild = interaction.guild;
  const sequence = store.nextTicketSequence();
  const { channel, ticket } = await createTicketChannel({
    guild,
    config,
    owner,
    sequence,
    exam,
    note
  });

  store.createTicket(ticket);
  return { channel, ticket };
}

async function syncTicketChannel(ticketId) {
  const ticket = store.getTicket(ticketId);
  if (!ticket) {
    return null;
  }

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return ticket;
  }

  const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  const botMessage = messages?.find((message) => message.author.id === client.user.id);
  if (!botMessage) {
    await channel.send(
      ticket.status === "closed"
        ? buildTicketClosedPayload(ticket)
        : buildTicketChannelPayload(ticket)
    );
    return ticket;
  }

  await botMessage.edit(
    ticket.status === "closed"
      ? buildTicketClosedPayload(ticket)
      : buildTicketChannelPayload(ticket)
  );
  return ticket;
}

async function closeTicket(ticketId, actorId, reason = "") {
  const updated = store.updateTicket(ticketId, (draft) => {
    draft.status = "closed";
    draft.closedBy = actorId;
    draft.closeReason = reason;
    draft.updatedAt = new Date().toISOString();
    return draft;
  });

  if (!updated) {
    return null;
  }

  const channel = await client.channels.fetch(updated.channelId).catch(() => null);
  if (channel) {
    if (config.ticketArchiveCategoryId) {
      await channel.setParent(config.ticketArchiveCategoryId).catch(() => {});
    }
    await channel.permissionOverwrites.edit(updated.ownerId, {
      ViewChannel: false
    }).catch(() => {});
  }

  await syncTicketChannel(updated.id);
  return updated;
}

async function maybeGrantPaidRole(invoice) {
  if (!config.paidRoleId || !invoice.guildId) {
    return;
  }

  const guild = await client.guilds.fetch(invoice.guildId).catch(() => null);
  if (!guild) {
    return;
  }

  const member = await guild.members.fetch(invoice.userId).catch(() => null);
  if (!member) {
    return;
  }

  if (!member.roles.cache.has(config.paidRoleId)) {
    await member.roles.add(config.paidRoleId).catch((error) => {
      console.error(`Failed to add role ${config.paidRoleId} to ${invoice.userId}:`, error);
    });
  }
}

async function markInvoicePaid(invoiceId, reason = "manual") {
  const invoice = store.getInvoice(invoiceId);
  if (!invoice) {
    return null;
  }

  const targetMethod =
    invoice.methods.find((method) => method.id === invoice.selectedMethodId) ??
    invoice.methods[0];

  const methodConfig = getMethodConfig(targetMethod.methodId);
  const updated = store.updateInvoice(invoiceId, (draft) => {
    const method =
      draft.methods.find((entry) => entry.id === draft.selectedMethodId) ?? draft.methods[0];
    method.status = "paid";
    method.paidAt = new Date().toISOString();
    method.receivedAtomic = method.expectedAtomic;
    method.receivedDisplayAmount = formatUnits(method.expectedAtomic, methodConfig.decimals);
    method.detectedTxHash = method.detectedTxHash ?? reason;
    draft.selectedMethodId = method.id;
    draft.status = "paid";
    draft.updatedAt = new Date().toISOString();
    return draft;
  });

  if (updated && !store.hasPaidRecord(updated.id)) {
    const method =
      updated.methods.find((entry) => entry.id === updated.selectedMethodId) ?? updated.methods[0];
    store.recordPaidUser({
      invoiceId: updated.id,
      userId: updated.userId,
      username: updated.username,
      guildId: updated.guildId,
      usdAmount: updated.usdAmount,
      exam: updated.exam,
      paidAt: updated.updatedAt,
      method: method.paymentTitle,
      txHash: method.detectedTxHash
    });
  }

  await maybeGrantPaidRole(updated);
  await renderInvoiceMessage(updated);
  await sendPaidAnnouncement(updated);
  return updated;
}

const watcher = new PaymentWatcher({
  client,
  config,
  store,
  onInvoicePaid: async (invoice) => {
    await maybeGrantPaidRole(invoice);
    await renderInvoiceMessage(invoice);
    await sendPaidAnnouncement(invoice);
  }
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  watcher.start();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    const isPublicCustomerFlow =
      (interaction.isButton() &&
        (interaction.customId === "ticket:create" ||
          interaction.customId.startsWith("choose:") ||
          interaction.customId.startsWith("back:") ||
          interaction.customId.startsWith("check:") ||
          interaction.customId.startsWith("refresh:") ||
          interaction.customId.startsWith("ticket-close:"))) ||
      (interaction.isStringSelectMenu() && interaction.customId === "ticket-exam-select") ||
      (interaction.isModalSubmit() && interaction.customId === "ticket-other-modal");

    if (interaction.user && !isAllowedUser(interaction.user.id) && !isPublicCustomerFlow) {
      if (interaction.isAutocomplete()) {
        await interaction.respond([]);
        return;
      }

      if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
        await interaction.reply({
          content: "You are not allowed to use this bot.",
          ephemeral: true
        }).catch(() => {});
        return;
      }

      if (interaction.isChatInputCommand()) {
        await interaction.reply({
          content: "You are not allowed to use this bot.",
          ephemeral: true
        }).catch(() => {});
        return;
      }
    }

    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);

      if (interaction.commandName === "pay" && focused.name === "exam") {
        const suggestions = examSuggestions(focused.value);
        await interaction.respond(
          suggestions.map((exam) => ({ name: exam, value: exam }))
        );
        return;
      }

      if (interaction.commandName === "list" && focused.name === "exam") {
        const suggestions = examSuggestions(focused.value);
        await interaction.respond(
          suggestions.map((exam) => ({ name: exam, value: exam }))
        );
        return;
      }

      if (interaction.commandName === "roster" && focused.name === "exam") {
        const suggestions = examSuggestions(focused.value);
        await interaction.respond(
          suggestions.map((exam) => ({ name: exam, value: exam }))
        );
        return;
      }

      if (
        interaction.commandName === "exams" &&
        interaction.options.getSubcommand() === "remove" &&
        focused.name === "name"
      ) {
        const suggestions = examSuggestions(focused.value);
        await interaction.respond(
          suggestions.map((exam) => ({ name: exam, value: exam }))
        );
        return;
      }

      await interaction.respond([]);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "ticket-exam-select") {
        const selected = interaction.values[0];
        if (selected === "__other__") {
          const modal = new ModalBuilder()
            .setCustomId("ticket-other-modal")
            .setTitle("Other Ticket Exam");

          const examInput = new TextInputBuilder()
            .setCustomId("exam_name")
            .setLabel("Exam name")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100);

          const noteInput = new TextInputBuilder()
            .setCustomId("exam_note")
            .setLabel("Optional details")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(300);

          modal.addComponents(
            new ActionRowBuilder().addComponents(examInput),
            new ActionRowBuilder().addComponents(noteInput)
          );

          await interaction.showModal(modal);
          return;
        }

        await interaction.deferUpdate();
        const { channel, ticket } = await createNewTicket({
          interaction,
          owner: interaction.user,
          exam: selected
        });
        await interaction.editReply({
          content: `Created ticket <#${channel.id}> (${ticket.id}) for **${selected}**.`,
          embeds: [],
          components: []
        });
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "ticket-other-modal") {
        await interaction.deferReply({ ephemeral: true });
        const exam = interaction.fields.getTextInputValue("exam_name");
        const note = interaction.fields.getTextInputValue("exam_note");
        const { channel, ticket } = await createNewTicket({
          interaction,
          owner: interaction.user,
          exam,
          note
        });
        await interaction.editReply(`Created ticket <#${channel.id}> (${ticket.id}) for **${exam}**.`);
        return;
      }
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "pay") {
        if (!isAllowedUser(interaction.user.id)) {
          await interaction.reply({
            content: "You are not allowed to use this bot.",
            ephemeral: true
          });
          return;
        }

        const exam = interaction.options.getString("exam", true);
        if (!ensureExamExists(exam)) {
          await interaction.reply({
            content: "That exam is not in the exam list yet. Use `/exams add` first.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply();
        const invoice = await createInvoiceForInteraction(interaction);
        const sent = await interaction.editReply(buildPaymentSelectionMessage(invoice));
        store.updateInvoice(invoice.id, (draft) => {
          draft.channelId = sent.channelId;
          draft.messageId = sent.id;
          draft.updatedAt = new Date().toISOString();
          return draft;
        });
        return;
      }

      if (interaction.commandName === "exams") {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: "You need Manage Server to update the exam list.",
            ephemeral: true
          });
          return;
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "add") {
          const name = interaction.options.getString("name", true);
          const added = store.addExam(name);
          await interaction.reply({
            content: added ? `Added exam: ${name}` : "That exam already exists or was invalid.",
            ephemeral: true
          });
          return;
        }

        if (subcommand === "remove") {
          const name = interaction.options.getString("name", true);
          const removed = store.removeExam(name);
          await interaction.reply({
            content: removed ? `Removed exam: ${name}` : "That exam was not found.",
            ephemeral: true
          });
          return;
        }

        if (subcommand === "list") {
          const exams = store.getExams();
          await interaction.reply({
            content: exams.length > 0 ? exams.join("\n") : "No exams configured yet.",
            ephemeral: true
          });
          return;
        }
      }

      if (interaction.commandName === "paid") {
        if (!isAllowedUser(interaction.user.id)) {
          await interaction.reply({
            content: "You are not allowed to use this bot.",
            ephemeral: true
          });
          return;
        }

        const paid = store.getPaidUsers().slice(0, 10);
        const lines =
          paid.length === 0
            ? ["No paid invoices yet."]
            : paid.map(
                (entry) =>
                  `${entry.username} paid ${formatUsd(entry.usdAmount)} for ${entry.exam || "N/A"} via ${entry.method} at ${entry.paidAt}`
              );

        await interaction.reply({ content: lines.join("\n") });
        return;
      }

      if (interaction.commandName === "list") {
        if (!isAllowedUser(interaction.user.id)) {
          await interaction.reply({
            content: "You are not allowed to use this bot.",
            ephemeral: true
          });
          return;
        }

        const exam = interaction.options.getString("exam", true);
        const paid = store.getPaidUsersByExam(exam);
        const lines =
          paid.length === 0
            ? [`No paid users found for ${exam}.`]
            : paid.map(
                (entry) =>
                  `${entry.username} paid ${formatUsd(entry.usdAmount)} via ${entry.method} at ${entry.paidAt}`
              );

        await interaction.reply({
          content: `Paid users for **${exam}**:\n${lines.join("\n")}`,
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName === "confirm") {
        if (!isAllowedUser(interaction.user.id)) {
          await interaction.reply({
            content: "You are not allowed to use this bot.",
            ephemeral: true
          });
          return;
        }

        const invoiceId = interaction.options.getString("invoice_id");
        const invoice = invoiceId
          ? store.getInvoice(invoiceId)
          : store.getLatestPendingInvoiceByChannel(interaction.channelId);

        if (!invoice) {
          await interaction.reply({ content: "No pending invoice found to confirm.", ephemeral: true });
          return;
        }

        await markInvoicePaid(invoice.id);
        await interaction.reply({ content: `Confirmed payment for ${invoice.id}.`, ephemeral: true });
        return;
      }

      if (interaction.commandName === "roster") {
        if (!isAllowedUser(interaction.user.id)) {
          await interaction.reply({
            content: "You are not allowed to use this bot.",
            ephemeral: true
          });
          return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: "You need Manage Server to update the paid roster.",
            ephemeral: true
          });
          return;
        }

        const subcommand = interaction.options.getSubcommand();
        const exam = interaction.options.getString("exam", true);
        const user = interaction.options.getUser("user", true);

        if (!ensureExamExists(exam)) {
          await interaction.reply({
            content: "That exam is not in the exam list.",
            ephemeral: true
          });
          return;
        }

        if (subcommand === "add") {
          store.addManualPaidUser({
            invoiceId: `MANUAL-${Date.now()}`,
            userId: user.id,
            username: user.tag ?? user.username,
            guildId: interaction.guildId,
            usdAmount: 0,
            exam,
            paidAt: new Date().toISOString(),
            method: "Manual",
            txHash: null
          });
          await interaction.reply({
            content: `Added <@${user.id}> to the paid roster for ${exam}.`,
            ephemeral: true
          });
          return;
        }

        if (subcommand === "remove") {
          const removed = store.removePaidUserByExamAndUser(exam, user.id);
          await interaction.reply({
            content: removed
              ? `Removed <@${user.id}> from the paid roster for ${exam}.`
              : `That user was not found in the paid roster for ${exam}.`,
            ephemeral: true
          });
          return;
        }
      }

      if (interaction.commandName === "ticket-panel") {
        if (!isAllowedUser(interaction.user.id)) {
          await interaction.reply({
            content: "You are not allowed to use this bot.",
            ephemeral: true
          });
          return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!isSupportMember(member)) {
          await interaction.reply({ content: "Only support staff can post the ticket panel.", ephemeral: true });
          return;
        }

        const title = interaction.options.getString("title") ?? undefined;
        const description = interaction.options.getString("description") ?? undefined;
        await interaction.reply(buildTicketPanelPayload({ title, description }));
        return;
      }

      if (interaction.commandName === "ticket-add") {
        if (!isAllowedUser(interaction.user.id)) {
          await interaction.reply({
            content: "You are not allowed to use this bot.",
            ephemeral: true
          });
          return;
        }

        const ticket = store.getTicketByChannel(interaction.channelId);
        if (!ticket || ticket.status !== "open") {
          await interaction.reply({ content: "This command only works in an open ticket.", ephemeral: true });
          return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (interaction.user.id !== ticket.ownerId && !isSupportMember(member)) {
          await interaction.reply({ content: "You are not allowed to manage this ticket.", ephemeral: true });
          return;
        }

        const user = interaction.options.getUser("user", true);
        const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
        await channel.permissionOverwrites.edit(user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        });

        store.updateTicket(ticket.id, (draft) => {
          if (!draft.participants.includes(user.id)) {
            draft.participants.push(user.id);
          }
          draft.updatedAt = new Date().toISOString();
          return draft;
        });

        await interaction.reply({ content: `Added <@${user.id}> to the ticket.` });
        return;
      }

      if (interaction.commandName === "ticket-remove") {
        if (!isAllowedUser(interaction.user.id)) {
          await interaction.reply({
            content: "You are not allowed to use this bot.",
            ephemeral: true
          });
          return;
        }

        const ticket = store.getTicketByChannel(interaction.channelId);
        if (!ticket || ticket.status !== "open") {
          await interaction.reply({ content: "This command only works in an open ticket.", ephemeral: true });
          return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (interaction.user.id !== ticket.ownerId && !isSupportMember(member)) {
          await interaction.reply({ content: "You are not allowed to manage this ticket.", ephemeral: true });
          return;
        }

        const user = interaction.options.getUser("user", true);
        if (user.id === ticket.ownerId) {
          await interaction.reply({ content: "You cannot remove the ticket owner.", ephemeral: true });
          return;
        }

        const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
        await channel.permissionOverwrites.delete(user.id).catch(() => {});

        store.updateTicket(ticket.id, (draft) => {
          draft.participants = draft.participants.filter((entry) => entry !== user.id);
          draft.updatedAt = new Date().toISOString();
          return draft;
        });

        await interaction.reply({ content: `Removed <@${user.id}> from the ticket.` });
        return;
      }

      if (interaction.commandName === "ticket-close") {
        if (!isAllowedUser(interaction.user.id)) {
          await interaction.reply({
            content: "You are not allowed to use this bot.",
            ephemeral: true
          });
          return;
        }

        const ticket = store.getTicketByChannel(interaction.channelId);
        if (!ticket || ticket.status !== "open") {
          await interaction.reply({ content: "This command only works in an open ticket.", ephemeral: true });
          return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (interaction.user.id !== ticket.ownerId && !isSupportMember(member)) {
          await interaction.reply({ content: "You are not allowed to close this ticket.", ephemeral: true });
          return;
        }

        const reason = interaction.options.getString("reason") ?? "";
        await closeTicket(ticket.id, interaction.user.id, reason);
        await interaction.reply({ content: `Closed ${ticket.id}.` });
        return;
      }

      if (interaction.commandName === "ticket-claim") {
        if (!isAllowedUser(interaction.user.id)) {
          await interaction.reply({
            content: "You are not allowed to use this bot.",
            ephemeral: true
          });
          return;
        }

        const ticket = store.getTicketByChannel(interaction.channelId);
        if (!ticket || ticket.status !== "open") {
          await interaction.reply({ content: "This command only works in an open ticket.", ephemeral: true });
          return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!isSupportMember(member)) {
          await interaction.reply({ content: "Only support staff can claim tickets.", ephemeral: true });
          return;
        }

        const updated = store.updateTicket(ticket.id, (draft) => {
          draft.claimedBy = interaction.user.id;
          draft.updatedAt = new Date().toISOString();
          return draft;
        });
        await syncTicketChannel(updated.id);
        await interaction.reply({ content: `Claimed ${updated.id}.` });
        return;
      }

      if (interaction.commandName === "watermark") {
        if (!isAllowedUser(interaction.user.id)) {
          await interaction.reply({
            content: "You are not allowed to use this bot.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        const pdfAttachment = interaction.options.getAttachment("pdf", true);
        if (!pdfAttachment.contentType?.includes("pdf") && !pdfAttachment.name.toLowerCase().endsWith(".pdf")) {
          await interaction.editReply("The `pdf` attachment must be a PDF file.");
          return;
        }

        const pdfBytes = await downloadAttachment(pdfAttachment);
        const overlayAssets = [];
        const fallback = loadDefaultOverlay(config.defaultWatermarkOverlayOnePath);
        if (fallback) {
          overlayAssets.push(fallback);
        }

        const output = await watermarkPdf({
          pdfBytes,
          textLines: ["!YSL", "!BKING"],
          overlayAssets
        });

        const baseName = pdfAttachment.name.replace(/\.pdf$/i, "");
        const file = new AttachmentBuilder(Buffer.from(output), {
          name: `${baseName}-watermarked.pdf`
        });

        await interaction.editReply({
          content: "Watermarked PDF ready.",
          files: [file]
        });
        return;
      }
    }

    if (interaction.isButton()) {
      const [action, invoiceId, methodId] = interaction.customId.split(":");
      if (action === "ticket" || action === "ticket-claim" || action === "ticket-close") {
        const customId = interaction.customId;

        if (customId === "ticket:create") {
          const existing = store.getTickets().find(
            (ticket) =>
              ticket.ownerId === interaction.user.id &&
              ticket.guildId === interaction.guildId &&
              ticket.status === "open"
          );
          if (existing) {
            await interaction.reply({
              content: `You already have an open ticket: <#${existing.channelId}>`,
              ephemeral: true
            });
            return;
          }

          const exams = store.getExams();
          if (exams.length === 0) {
            await interaction.reply({
              content: "No exams are configured yet. Add exams with `/exams add` first.",
              ephemeral: true
            });
            return;
          }

          await interaction.reply(buildTicketExamPromptPayload(exams));
          return;
        }

        const [ticketAction, ticketId] = customId.split(":");
        const ticket = store.getTicket(ticketId);
        if (!ticket) {
          await interaction.reply({ content: "That ticket no longer exists.", ephemeral: true });
          return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

        if (ticketAction === "ticket-claim") {
          if (!isSupportMember(member)) {
            await interaction.reply({ content: "Only support staff can claim tickets.", ephemeral: true });
            return;
          }

          const updated = store.updateTicket(ticket.id, (draft) => {
            draft.claimedBy = interaction.user.id;
            draft.updatedAt = new Date().toISOString();
            return draft;
          });
          await syncTicketChannel(updated.id);
          await interaction.reply({ content: `Claimed ${updated.id}.`, ephemeral: true });
          return;
        }

        if (ticketAction === "ticket-close") {
          if (interaction.user.id !== ticket.ownerId && !isSupportMember(member)) {
            await interaction.reply({ content: "You are not allowed to close this ticket.", ephemeral: true });
            return;
          }

          await closeTicket(ticket.id, interaction.user.id, "Closed from button");
          await interaction.reply({ content: `Closed ${ticket.id}.`, ephemeral: true });
          return;
        }
      }

      const invoice = store.getInvoice(invoiceId);
      if (!invoice) {
        await interaction.reply({ content: "That invoice no longer exists.", ephemeral: true });
        return;
      }

      if (invoice.userId !== interaction.user.id && !isAllowedUser(interaction.user.id)) {
        await interaction.reply({
          content: "You can only manage your own invoice.",
          ephemeral: true
        });
        return;
      }

      await interaction.deferUpdate();

      if (action === "choose") {
        const updated = await watcher.initializeSelectedMethod(invoice.id, methodId);
        await interaction.editReply(buildChosenPaymentMessage(updated));
        return;
      }

      if (action === "back") {
        const updated = store.updateInvoice(invoice.id, (draft) => {
          draft.selectedMethodId = null;
          draft.updatedAt = new Date().toISOString();
          return draft;
        });
        await interaction.editReply(buildPaymentSelectionMessage(updated));
        return;
      }

      if (action === "refresh" && invoice.status !== "paid") {
        const refreshed = await refreshInvoice(invoice.id);
        const payload = refreshed.selectedMethodId
          ? buildChosenPaymentMessage(refreshed)
          : buildPaymentSelectionMessage(refreshed);
        await interaction.editReply(payload);
        return;
      }

      if (action === "check") {
        await watcher.tick();
        const latest = store.getInvoice(invoice.id);
        const payload =
          latest.status === "paid"
            ? buildPaidMessage(latest, config.paidMentionId)
            : latest.selectedMethodId
              ? buildChosenPaymentMessage(latest)
              : buildPaymentSelectionMessage(latest);
        await interaction.editReply(payload);
      }
    }
  } catch (error) {
    console.error("Interaction failed:", error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: "The bot hit an error handling that payment." }).catch(
        () => {}
      );
      return;
    }

    await interaction.reply({
      content: "The bot hit an error handling that payment.",
      ephemeral: true
    }).catch(() => {});
  }
});

client.login(config.discordToken);
