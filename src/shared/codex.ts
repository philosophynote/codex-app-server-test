export type CodexConnectionStatus =
  | "停止中"
  | "起動中"
  | "準備完了"
  | "実行中"
  | "エラー";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  status?: "streaming" | "done" | "error";
};

export type CodexLogEntry = {
  id: string;
  level: "info" | "warn" | "error";
  text: string;
  timestamp: string;
};

export type CodexRuntimeStatus = {
  status: CodexConnectionStatus;
  cwd: string;
  model: string;
  threadId: string | null;
  turnId: string | null;
};

export type CodexEvent =
  | { type: "status"; payload: CodexRuntimeStatus }
  | { type: "assistant-delta"; payload: { messageId: string; delta: string } }
  | { type: "assistant-start"; payload: { messageId: string } }
  | { type: "assistant-complete"; payload: { messageId: string } }
  | { type: "log"; payload: CodexLogEntry }
  | { type: "error"; payload: { message: string } };

export type CodexDesktopApi = {
  start: () => Promise<CodexRuntimeStatus>;
  sendMessage: (text: string) => Promise<{ accepted: boolean }>;
  interrupt: () => Promise<{ interrupted: boolean }>;
  stop: () => Promise<void>;
  getStatus: () => Promise<CodexRuntimeStatus>;
  onEvent: (listener: (event: CodexEvent) => void) => () => void;
};
