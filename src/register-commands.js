import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { config, validateConfig } from "./config.js";

validateConfig();

const commands = [
  new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Create a crypto payment invoice from a USD amount.")
    .addNumberOption((option) =>
      option
        .setName("amount")
        .setDescription("USD amount to charge.")
        .setMinValue(0.01)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("exam")
        .setDescription("Select the exam this payment is for.")
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addUserOption((option) =>
      option
        .setName("customer")
        .setDescription("Customer who should own this invoice.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("note")
        .setDescription("Optional description for the invoice.")
        .setMaxLength(120)
    ),
  new SlashCommandBuilder()
    .setName("exams")
    .setDescription("Manage the exam list used by /pay.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add an exam to the list.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Exam name.")
            .setRequired(true)
            .setMaxLength(100)
        )
        .addStringOption((option) =>
          option
            .setName("brand")
            .setDescription("Brand this exam belongs to (default: YSL).")
            .setRequired(false)
            .addChoices(
              { name: "YSL", value: "YSL" },
              { name: "SORE", value: "SORE" }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove an exam from the list.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Exam name.")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List the exams currently available.")
    ),
  new SlashCommandBuilder()
    .setName("paid")
    .setDescription("Show recent paid invoices from the local ledger."),
  new SlashCommandBuilder()
    .setName("list")
    .setDescription("List paid users for a specific exam.")
    .addStringOption((option) =>
      option
        .setName("exam")
        .setDescription("Exam to list paid users for.")
        .setAutocomplete(true)
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("roster")
    .setDescription("Manually manage the paid roster for an exam.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Manually add a user to an exam roster.")
        .addStringOption((option) =>
          option
            .setName("exam")
            .setDescription("Exam name.")
            .setAutocomplete(true)
            .setRequired(true)
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("User to add.")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a user from an exam roster.")
        .addStringOption((option) =>
          option
            .setName("exam")
            .setDescription("Exam name.")
            .setAutocomplete(true)
            .setRequired(true)
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("User to remove.")
            .setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName("confirm")
    .setDescription("Manually confirm a pending invoice.")
    .addStringOption((option) =>
      option
        .setName("invoice_id")
        .setDescription("Optional invoice ID. If omitted, confirms the latest pending invoice in this channel.")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("Post the ticket creation panel in this channel.")
    .addStringOption((option) =>
      option
        .setName("title")
        .setDescription("Optional panel title.")
        .setRequired(false)
        .setMaxLength(100)
    )
    .addStringOption((option) =>
      option
        .setName("description")
        .setDescription("Optional panel description.")
        .setRequired(false)
        .setMaxLength(300)
    ),
  new SlashCommandBuilder()
    .setName("ticket-add")
    .setDescription("Add a user to the current ticket.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User to add to the ticket.")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("ticket-remove")
    .setDescription("Remove a user from the current ticket.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User to remove from the ticket.")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("ticket-close")
    .setDescription("Close the current ticket.")
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Optional closing reason.")
        .setRequired(false)
        .setMaxLength(200)
    ),
  new SlashCommandBuilder()
    .setName("ticket-claim")
    .setDescription("Claim the current ticket."),
  new SlashCommandBuilder()
    .setName("watermark")
    .setDescription("Apply the default exam watermark to a PDF and return the result.")
    .addAttachmentOption((option) =>
      option
        .setName("pdf")
        .setDescription("PDF file to watermark.")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("ticketmenu")
    .setDescription("Manage the ticket creation menu (separate from the exam list).")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add an item to the ticket menu.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Item name.")
            .setRequired(true)
            .setMaxLength(100)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove an item from the ticket menu.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Item name.")
            .setRequired(true)
            .setMaxLength(100)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List the current ticket menu items.")
    )
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(config.discordToken);

const route = config.discordGuildId
  ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
  : Routes.applicationCommands(config.discordClientId);

await rest.put(route, { body: commands });

console.log(
  config.discordGuildId
    ? `Registered guild commands for guild ${config.discordGuildId}`
    : "Registered global commands"
);
