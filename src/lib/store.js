import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const DEFAULT_STORE = {
  counters: {
    invoice: 0,
    derivation: 0,
    ticket: 0
  },
  watcherState: {},
  invoices: [],
  paidUsers: [],
  exams: [],
  ticketMenuItems: [],
  tickets: []
};

function normalizeExam(entry) {
  if (typeof entry === "string") return { name: entry, brand: "YSL" };
  return entry;
}

function cloneDefaultStore() {
  return JSON.parse(JSON.stringify(DEFAULT_STORE));
}

export class JsonStore {
  constructor(filePath = STORE_PATH) {
    this.filePath = filePath;
    this.data = cloneDefaultStore();
    this.ensureLoaded();
  }

  ensureLoaded() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

    if (!fs.existsSync(this.filePath)) {
      this.persist();
      return;
    }

    const raw = fs.readFileSync(this.filePath, "utf8");
    if (!raw.trim()) {
      this.persist();
      return;
    }

    this.data = {
      ...cloneDefaultStore(),
      ...JSON.parse(raw)
    };
  }

  persist() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  nextInvoiceSequence() {
    this.data.counters.invoice += 1;
    this.persist();
    return this.data.counters.invoice;
  }

  nextDerivationIndex() {
    this.data.counters.derivation += 1;
    this.persist();
    return this.data.counters.derivation;
  }

  nextTicketSequence() {
    this.data.counters.ticket += 1;
    this.persist();
    return this.data.counters.ticket;
  }

  getInvoices() {
    return this.data.invoices;
  }

  getInvoice(invoiceId) {
    return this.data.invoices.find((invoice) => invoice.id === invoiceId) ?? null;
  }

  createInvoice(invoice) {
    this.data.invoices.push(invoice);
    this.persist();
    return invoice;
  }

  updateInvoice(invoiceId, updater) {
    const index = this.data.invoices.findIndex((invoice) => invoice.id === invoiceId);
    if (index === -1) {
      return null;
    }

    const current = this.data.invoices[index];
    const next = updater(structuredClone(current));
    this.data.invoices[index] = next;
    this.persist();
    return next;
  }

  getPendingInvoices() {
    return this.data.invoices.filter((invoice) => invoice.status !== "paid");
  }

  getLatestPendingInvoiceByChannel(channelId) {
    const matches = this.data.invoices
      .filter((invoice) => invoice.channelId === channelId && invoice.status !== "paid")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return matches[0] ?? null;
  }

  setWatcherState(networkKey, state) {
    this.data.watcherState[networkKey] = {
      ...(this.data.watcherState[networkKey] ?? {}),
      ...state
    };
    this.persist();
  }

  getWatcherState(networkKey) {
    return this.data.watcherState[networkKey] ?? {};
  }

  recordPaidUser(entry) {
    this.data.paidUsers.push(entry);
    this.persist();
  }

  hasPaidRecord(invoiceId) {
    return this.data.paidUsers.some((entry) => entry.invoiceId === invoiceId);
  }

  getPaidUsers() {
    return [...this.data.paidUsers].sort((a, b) => {
      return new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime();
    });
  }

  getPaidUsersByExam(exam) {
    return this.getPaidUsers().filter(
      (entry) => (entry.exam ?? "").toLowerCase() === exam.toLowerCase()
    );
  }

  addManualPaidUser(entry) {
    this.data.paidUsers.push(entry);
    this.persist();
    return entry;
  }

  removePaidUserByExamAndUser(exam, userId) {
    const index = this.data.paidUsers.findIndex(
      (entry) =>
        (entry.exam ?? "").toLowerCase() === exam.toLowerCase() &&
        entry.userId === userId
    );

    if (index === -1) {
      return false;
    }

    this.data.paidUsers.splice(index, 1);
    this.persist();
    return true;
  }

  getExams() {
    return [...this.data.exams]
      .map(normalizeExam)
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  }

  getExamsWithBrand() {
    return [...this.data.exams]
      .map(normalizeExam)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getExamBrand(name) {
    const entry = this.data.exams
      .map(normalizeExam)
      .find((e) => e.name.toLowerCase() === name.trim().toLowerCase());
    return entry?.brand ?? "YSL";
  }

  addExam(name, brand = "YSL") {
    const normalized = name.trim();
    if (!normalized) {
      return false;
    }

    const exists = this.data.exams
      .map(normalizeExam)
      .some((e) => e.name.toLowerCase() === normalized.toLowerCase());
    if (exists) {
      return false;
    }

    this.data.exams.push({ name: normalized, brand });
    this.persist();
    return true;
  }

  removeExam(name) {
    const normalized = name.trim().toLowerCase();
    const index = this.data.exams
      .map(normalizeExam)
      .findIndex((e) => e.name.toLowerCase() === normalized);
    if (index === -1) {
      return false;
    }

    this.data.exams.splice(index, 1);
    this.persist();
    return true;
  }

  getTicketMenuItems() {
    return [...(this.data.ticketMenuItems ?? [])].sort((a, b) => a.localeCompare(b));
  }

  addTicketMenuItem(name) {
    if (!this.data.ticketMenuItems) this.data.ticketMenuItems = [];
    const normalized = name.trim();
    if (!normalized) return false;
    const exists = this.data.ticketMenuItems.some(
      (e) => e.toLowerCase() === normalized.toLowerCase()
    );
    if (exists) return false;
    this.data.ticketMenuItems.push(normalized);
    this.persist();
    return true;
  }

  removeTicketMenuItem(name) {
    if (!this.data.ticketMenuItems) { this.data.ticketMenuItems = []; return false; }
    const index = this.data.ticketMenuItems.findIndex(
      (e) => e.toLowerCase() === name.trim().toLowerCase()
    );
    if (index === -1) return false;
    this.data.ticketMenuItems.splice(index, 1);
    this.persist();
    return true;
  }

  createTicket(ticket) {
    this.data.tickets.push(ticket);
    this.persist();
    return ticket;
  }

  getTicket(ticketId) {
    return this.data.tickets.find((ticket) => ticket.id === ticketId) ?? null;
  }

  getTickets() {
    return this.data.tickets;
  }

  getTicketByChannel(channelId) {
    return this.data.tickets.find((ticket) => ticket.channelId === channelId) ?? null;
  }

  updateTicket(ticketId, updater) {
    const index = this.data.tickets.findIndex((ticket) => ticket.id === ticketId);
    if (index === -1) {
      return null;
    }

    const current = this.data.tickets[index];
    const next = updater(structuredClone(current));
    this.data.tickets[index] = next;
    this.persist();
    return next;
  }
}
