import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";
import { formatCryptoAmount, formatUsd } from "./pricing.js";

function chunkMethods(methods, size = 4) {
  const chunks = [];
  for (let index = 0; index < methods.length; index += size) {
    chunks.push(methods.slice(index, index + size));
  }
  return chunks;
}

function resolveButtonStyle(method) {
  if (method.symbol === "USDC") return ButtonStyle.Primary;
  if (method.symbol === "USDT") return ButtonStyle.Success;
  return ButtonStyle.Secondary;
}

function selectedMethod(invoice) {
  return invoice.methods.find((method) => method.id === invoice.selectedMethodId) ?? null;
}

export function buildPaymentSelectionMessage(invoice) {
  const embed = new EmbedBuilder()
    .setTitle("💳 Select Payment Crypto")
    .setDescription(
      [
        `**Invoice ID:** \`${invoice.id}\``,
        `**Amount Due:** \`${invoice.usdAmount.toFixed(2)} USD\``,
        invoice.exam ? `**Exam:** ${invoice.exam}` : null,
        invoice.note ? `**Note:** ${invoice.note}` : null,
        "",
        "Select which cryptocurrency you'd like to pay with:",
        "Click a button below to get the wallet address and amount."
      ].filter(Boolean).join("\n")
    )
    .setColor(0xf4d03f)
    .setTimestamp(new Date(invoice.updatedAt));

  const rows = chunkMethods(invoice.methods).map((group) =>
    new ActionRowBuilder().addComponents(
      ...group.map((method) =>
        new ButtonBuilder()
          .setCustomId(`choose:${invoice.id}:${method.methodId}`)
          .setLabel(method.buttonLabel)
          .setStyle(resolveButtonStyle(method))
      )
    )
  );

  return {
    embeds: [embed],
    components: rows
  };
}

function paymentStateLine(method) {
  if (method.status === "paid") {
    return "✅ Payment confirmed.";
  }
  if (method.status === "detected") {
    return "⏳ Payment detected. Waiting for confirmations.";
  }
  if (method.status === "partial") {
    return "🟨 Partial payment detected.";
  }
  if (method.receivedAtomic) {
    return "🟨 Partial payment detected.";
  }
  if (method.watcherType === "manual") {
    return "⏳ Waiting for payment.... Staff can use `/confirm` to manually confirm.";
  }
  return "⏳ Waiting for payment.... Auto-detection is active.";
}

function paymentProgressLines(method) {
  if (!method.receivedAtomic || !method.expectedAtomic) {
    return [];
  }

  const received = Number(method.receivedDisplayAmount ?? "0");
  const expected = Number(method.displayAmount ?? "0");
  const remaining = Math.max(expected - received, 0);

  if (received <= 0) {
    return [];
  }

  if (remaining <= 0) {
    return [`**Received:** \`${method.receivedDisplayAmount} ${method.symbol}\``];
  }

  return [
    `**Paid so far:** \`${formatCryptoAmount(received, method.quoteDecimals ?? 8)} ${method.symbol}\``,
    `**Remaining:** \`${formatCryptoAmount(remaining, method.quoteDecimals ?? 8)} ${method.symbol}\``
  ];
}

export function buildChosenPaymentMessage(invoice) {
  const method = selectedMethod(invoice);
  if (!method) {
    return buildPaymentSelectionMessage(invoice);
  }

  const embed = new EmbedBuilder()
    .setTitle(method.paymentTitle)
    .setDescription(
      [
        `**Invoice ID:** \`${invoice.id}\``,
        `**Amount Due:** \`${method.displayAmount} ${method.symbol}\` (${formatUsd(invoice.usdAmount)})`,
        invoice.exam ? `**Exam:** ${invoice.exam}` : null,
        invoice.note ? `**Note:** ${invoice.note}` : null,
        `**Network:** ${method.network}`,
        "",
        "**Send to this address:**",
        `\`${method.address}\``,
        "",
        paymentStateLine(method),
        ...paymentProgressLines(method),
        "Payment will timeout after 30 minutes. Staff can use `/confirm` to manually confirm."
      ].filter(Boolean).join("\n")
    )
    .setColor(method.status === "paid" ? 0x57f287 : 0x5865f2)
    .setTimestamp(new Date(invoice.updatedAt));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`back:${invoice.id}`)
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`check:${invoice.id}`)
      .setLabel("Check Payment")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`refresh:${invoice.id}`)
      .setLabel("Refresh Quote")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: invoice.status === "paid" ? [] : [buttons]
  };
}

export function buildPaidMessage(invoice, mentionId) {
  const method = selectedMethod(invoice) ?? invoice.methods.find((entry) => entry.status === "paid");
  const received = method?.receivedDisplayAmount ?? method?.displayAmount;

  const embed = new EmbedBuilder()
    .setTitle("✅ Payment Detected!")
    .setDescription(
      [
        `**Invoice ID:** \`${invoice.id}\``,
        invoice.exam ? `**Exam:** ${invoice.exam}` : null,
        `**Received:** \`${received} ${method?.symbol ?? ""}\``,
        `**Expected:** \`${method?.displayAmount ?? ""} ${method?.symbol ?? ""}\``,
        `**USD Value:** ${formatUsd(invoice.usdAmount)}`,
        "",
        `Payment has been automatically confirmed. <@${mentionId}>`
      ].filter(Boolean).join("\n")
    )
    .setColor(0x57f287)
    .setTimestamp(new Date(invoice.updatedAt));

  return {
    content: `<@${mentionId}>`,
    embeds: [embed],
    components: []
  };
}

export function buildPaidAnnouncementMessage(invoice, mentionId) {
  return buildPaidMessage(invoice, mentionId);
}
