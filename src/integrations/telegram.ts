import pino from "pino";

const logger = pino({ name: "nightforge-telegram" });

const TELEGRAM_API_URL = "https://api.telegram.org";

export interface TelegramMessage {
  chatId: string;
  text: string;
}

export interface TelegramCommand {
  command: string;
  args: string[];
  chatId: string;
  messageId: number;
}

export type CommandHandler = (cmd: TelegramCommand) => Promise<string>;

export interface TelegramBot {
  sendMessage(chatId: string, text: string): Promise<void>;
  notifyTicketStarted(ticketId: string, title: string): Promise<void>;
  notifyTicketCompleted(
    ticketId: string,
    title: string,
    costUsd: number
  ): Promise<void>;
  notifyTicketFailed(ticketId: string, title: string, reason: string): Promise<void>;
  notifyNeedsInput(ticketId: string, question: string): Promise<void>;
  notifyRolledBack(ticketId: string, title: string): Promise<void>;
  sendMorningDigest(summary: string): Promise<void>;
  sendBudgetAlert(percentUsed: number, dailySpend: number): Promise<void>;
  setCommandHandler(handler: CommandHandler): void;
  handleCommand(cmd: TelegramCommand): Promise<string>;
  parseCommand(text: string): { command: string; args: string[] } | null;
}

export function createTelegramBot(
  botToken: string,
  defaultChatId: string
): TelegramBot {
  let commandHandler: CommandHandler | null = null;

  const apiCall = async <T>(
    method: string,
    body: Record<string, unknown>
  ): Promise<T> => {
    const response = await fetch(`${TELEGRAM_API_URL}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Telegram API error: ${String(response.status)}`);
    }

    return (await response.json()) as T;
  };

  return {
    async sendMessage(chatId: string, text: string): Promise<void> {
      await apiCall("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      });
      logger.info({ chatId }, "Telegram message sent");
    },

    async notifyTicketStarted(ticketId: string, title: string): Promise<void> {
      const text = `🔨 *Started:* ${title}\n\`Ticket: ${ticketId}\``;
      await this.sendMessage(defaultChatId, text);
    },

    async notifyTicketCompleted(
      ticketId: string,
      title: string,
      costUsd: number
    ): Promise<void> {
      const text = `✅ *Completed:* ${title}\n\`Ticket: ${ticketId}\`\n💰 Cost: $${costUsd.toFixed(4)}`;
      await this.sendMessage(defaultChatId, text);
    },

    async notifyTicketFailed(
      ticketId: string,
      title: string,
      reason: string
    ): Promise<void> {
      const text = `❌ *Failed:* ${title}\n\`Ticket: ${ticketId}\`\nReason: ${reason}`;
      await this.sendMessage(defaultChatId, text);
    },

    async notifyNeedsInput(ticketId: string, question: string): Promise<void> {
      const text = `❓ *Needs Input:* \n\`Ticket: ${ticketId}\`\n${question}`;
      await this.sendMessage(defaultChatId, text);
    },

    async notifyRolledBack(ticketId: string, title: string): Promise<void> {
      const text = `⏪ *Rolled Back:* ${title}\n\`Ticket: ${ticketId}\``;
      await this.sendMessage(defaultChatId, text);
    },

    async sendMorningDigest(summary: string): Promise<void> {
      const text = `🌅 *Morning Digest*\n\n${summary}`;
      await this.sendMessage(defaultChatId, text);
    },

    async sendBudgetAlert(
      percentUsed: number,
      dailySpend: number
    ): Promise<void> {
      const text = `⚠️ *Budget Alert*\nDaily spend: $${dailySpend.toFixed(2)} (${percentUsed.toFixed(0)}% of budget)`;
      await this.sendMessage(defaultChatId, text);
    },

    setCommandHandler(handler: CommandHandler): void {
      commandHandler = handler;
      logger.info("Command handler registered");
    },

    async handleCommand(cmd: TelegramCommand): Promise<string> {
      if (!commandHandler) {
        return "No command handler registered";
      }
      return await commandHandler(cmd);
    },

    parseCommand(text: string): { command: string; args: string[] } | null {
      if (!text.startsWith("/")) {
        return null;
      }

      const parts = text.slice(1).split(" ");
      const command = parts[0]?.toLowerCase() ?? "";
      const args = parts.slice(1);

      return { command, args };
    },
  };
}

export const AVAILABLE_COMMANDS = [
  { command: "status", description: "Show running agents" },
  { command: "pause", description: "Pause work on a project" },
  { command: "resume", description: "Resume work on a project" },
  { command: "approve", description: "Approve production deploy" },
  { command: "cancel", description: "Cancel a running ticket" },
  { command: "budget", description: "Show today's spend" },
] as const;
