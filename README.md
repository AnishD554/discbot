# Discord Crypto + Tickets Bot

This bot now includes:

- crypto payment invoices with `/pay`
- dynamic exam list management with `/exams`
- paid roster lookup with `/list`
- manual payment fallback with `/confirm`
- a full ticket workflow with `/ticket-panel`, create, claim, add/remove users, and close
- user access restricted to the configured `ALLOWED_USER_IDS`
- PDF watermarking with `/watermark`

## Payment Flow

1. Add exams with `/exams add`
2. Run `/pay amount:30 exam:<name> customer:@user`
3. User picks a crypto button
4. Bot shows the address and amount
5. Bot tracks payment progress
6. When paid, the original invoice updates and a separate paid announcement is posted

## Exam Commands

- `/exams add name:<exam>`
- `/exams remove name:<exam>`
- `/exams list`
- `/list exam:<exam>`
- `/roster add exam:<exam> user:<user>`
- `/roster remove exam:<exam> user:<user>`

`/pay` uses the exam list via autocomplete.

## Ticket Commands

- `/ticket-panel`
- `/ticket-claim`
- `/ticket-add user:<user>`
- `/ticket-remove user:<user>`
- `/ticket-close reason:<optional>`

Users create tickets from the panel button. Tickets open as private channels. Support staff can claim them, add/remove people, and close them.
When a user presses the ticket create button, the bot first asks which exam the ticket is for from the managed exam list, plus an `Other` option for custom entries.

## Watermark Command

- `/watermark pdf:<file>`

The bot returns a new PDF with the built-in center watermark image on every page plus scattered `!Norz` and `!Bking` text.
Put your default watermark image at [assets/watermark-overlay-1.png](/Users/anishdhamija/Desktop/newlahacks/assets/watermark-overlay-1.png).

## Required Steps

1. Update [.env](/Users/anishdhamija/Desktop/newlahacks/.env)
2. Re-register commands:

```bash
npm run register
```

3. Start the bot:

```bash
npm start
```

## Ticket Config

Optional env values:

- `TICKET_CATEGORY_ID`
- `TICKET_ARCHIVE_CATEGORY_ID`
- `TICKET_SUPPORT_ROLE_IDS`

`TICKET_SUPPORT_ROLE_IDS` should be a comma-separated list of role IDs.
