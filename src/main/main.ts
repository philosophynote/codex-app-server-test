import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import type {
  CodexConnectionStatus,
  CodexEvent,
  CodexRuntimeStatus,
} from "../shared/codex.js";

type JsonRpcResponse = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

const DEFAULT_MODEL = "gpt-5.4";
const WORKSPACE_CWD = process.cwd();

let mainWindow: BrowserWindow | null = null;

class CodexAppServerClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private status: CodexConnectionStatus = "停止中";
  private threadId: string | null = null;
  private turnId: string | null = null;
  private assistantMessageId: string | null = null;

  getStatus(): CodexRuntimeStatus {
    return {
      status: this.status,
      cwd: WORKSPACE_CWD,
      model: DEFAULT_MODEL,
      threadId: this.threadId,
      turnId: this.turnId,
    };
  }

  async start(): Promise<CodexRuntimeStatus> {
    if (this.proc !== null) {
      return this.getStatus();
    }

    this.updateStatus("起動中");
    this.addShellPath();

    this.proc = spawn("codex", ["app-server"], {
      cwd: WORKSPACE_CWD,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    const lines = readline.createInterface({ input: this.proc.stdout });
    lines.on("line", (line) => this.handleLine(line));

    this.proc.stderr.on("data", (chunk: Buffer) => {
      this.emitLog("warn", chunk.toString("utf8").trim());
    });

    this.proc.on("error", (error) => {
      this.failAllRequests(error);
      this.emitError(`codex app-server の起動に失敗しました: ${error.message}`);
      this.cleanupProcess();
      this.updateStatus("エラー");
    });

    this.proc.on("exit", (code, signal) => {
      this.failAllRequests(
        new Error(`codex app-server が終了しました: code=${code ?? "null"} signal=${signal ?? "null"}`),
      );
      this.cleanupProcess();
      this.updateStatus("停止中");
    });

    await this.request("initialize", {
      clientInfo: {
        name: "codex_local_chat",
        title: "Codex Local Chat",
        version: "0.1.0",
      },
    });
    this.notify("initialized", {});

    const threadStartResult = await this.request("thread/start", {
      cwd: WORKSPACE_CWD,
      model: DEFAULT_MODEL,
    });
    this.threadId = this.extractThreadId(threadStartResult);

    if (this.threadId === null) {
      throw new Error("thread/start の結果から threadId を取得できませんでした。");
    }

    this.emitLog("info", "codex app-server と接続しました。");
    this.updateStatus("準備完了");
    return this.getStatus();
  }

  async sendMessage(text: string): Promise<{ accepted: boolean }> {
    if (this.threadId === null) {
      throw new Error("Codex のスレッドがまだ準備できていません。");
    }
    if (this.turnId !== null) {
      throw new Error("前の応答がまだ実行中です。");
    }

    this.assistantMessageId = `assistant-${Date.now()}`;
    this.emit({
      type: "assistant-start",
      payload: { messageId: this.assistantMessageId },
    });
    this.updateStatus("実行中");

    const result = await this.request("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text, text_elements: [] }],
    });

    this.turnId = this.extractTurnId(result) ?? this.turnId;
    return { accepted: true };
  }

  async interrupt(): Promise<{ interrupted: boolean }> {
    if (this.threadId === null || this.turnId === null) {
      return { interrupted: false };
    }

    await this.request("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.turnId,
    });
    this.emitLog("info", "実行中のターンを停止しました。");
    this.turnId = null;
    this.updateStatus("準備完了");
    return { interrupted: true };
  }

  async stop(): Promise<void> {
    this.proc?.kill();
    this.cleanupProcess();
    this.updateStatus("停止中");
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const request = { id, method, params };
    this.write(request);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
  }

  private notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  private write(message: unknown): void {
    if (this.proc === null) {
      throw new Error("codex app-server が起動していません。");
    }
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      this.emitLog("warn", "codex app-server からJSONではない出力を受信しました。");
      return;
    }

    if (typeof message.id === "number") {
      this.handleResponse(message);
      return;
    }

    if (typeof message.method === "string") {
      this.handleNotification(message.method, message.params);
    }
  }

  private handleResponse(message: JsonRpcResponse): void {
    if (message.id === undefined) {
      return;
    }

    const pending = this.pendingRequests.get(message.id);
    if (pending === undefined) {
      return;
    }

    this.pendingRequests.delete(message.id);
    if (message.error !== undefined) {
      pending.reject(new Error(message.error.message ?? "Codex app-server request failed."));
      return;
    }

    pending.resolve(message.result);
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === "turn/started") {
      this.turnId = this.extractTurnId(params) ?? this.turnId;
      this.updateStatus("実行中");
      return;
    }

    if (method === "item/agentMessage/delta") {
      const delta = this.extractString(params, "delta");
      if (delta !== null) {
        this.emit({
          type: "assistant-delta",
          payload: {
            messageId: this.ensureAssistantMessageId(),
            delta,
          },
        });
      }
      return;
    }

    if (method === "turn/completed") {
      this.turnId = null;
      this.emit({
        type: "assistant-complete",
        payload: { messageId: this.ensureAssistantMessageId() },
      });
      this.assistantMessageId = null;
      this.updateStatus("準備完了");
      return;
    }

    if (method === "turn/plan/updated") {
      const explanation = this.extractString(params, "explanation");
      if (explanation !== null && explanation.length > 0) {
        this.emitLog("info", explanation);
      }
      return;
    }

    if (method === "warning" || method === "guardianWarning" || method === "configWarning") {
      this.emitLog("warn", this.extractString(params, "message") ?? method);
      return;
    }

    if (method === "error") {
      this.emitError(this.extractNestedErrorMessage(params) ?? "Codex でエラーが発生しました。");
    }
  }

  private cleanupProcess(): void {
    this.proc = null;
    this.threadId = null;
    this.turnId = null;
    this.assistantMessageId = null;
  }

  private failAllRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private updateStatus(status: CodexConnectionStatus): void {
    this.status = status;
    this.emit({ type: "status", payload: this.getStatus() });
  }

  private emitLog(level: "info" | "warn" | "error", text: string): void {
    if (text.length === 0) {
      return;
    }

    this.emit({
      type: "log",
      payload: {
        id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        level,
        text,
        timestamp: new Date().toLocaleTimeString("ja-JP"),
      },
    });
  }

  private emitError(message: string): void {
    this.emitLog("error", message);
    this.emit({ type: "error", payload: { message } });
  }

  private emit(event: CodexEvent): void {
    mainWindow?.webContents.send("codex:event", event);
  }

  private ensureAssistantMessageId(): string {
    if (this.assistantMessageId === null) {
      this.assistantMessageId = `assistant-${Date.now()}`;
      this.emit({
        type: "assistant-start",
        payload: { messageId: this.assistantMessageId },
      });
    }
    return this.assistantMessageId;
  }

  private extractThreadId(value: unknown): string | null {
    if (!this.isObject(value)) {
      return null;
    }
    const thread = value.thread;
    if (!this.isObject(thread)) {
      return null;
    }
    return typeof thread.id === "string" ? thread.id : null;
  }

  private extractTurnId(value: unknown): string | null {
    if (!this.isObject(value)) {
      return null;
    }
    const turn = value.turn;
    if (!this.isObject(turn)) {
      return null;
    }
    return typeof turn.id === "string" ? turn.id : null;
  }

  private extractString(value: unknown, key: string): string | null {
    if (!this.isObject(value)) {
      return null;
    }
    const text = value[key];
    return typeof text === "string" ? text : null;
  }

  private extractNestedErrorMessage(value: unknown): string | null {
    if (!this.isObject(value) || !this.isObject(value.error)) {
      return null;
    }
    return typeof value.error.message === "string" ? value.error.message : null;
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private addShellPath(): void {
    const currentPath = process.env.PATH ?? "";
    const requiredPaths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
    process.env.PATH = Array.from(new Set([...requiredPaths, ...currentPath.split(":")])).join(":");
  }
}

const codexClient = new CodexAppServerClient();

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Codex Local Chat",
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

app.on("ready", () => {
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  void codexClient.stop();
});

ipcMain.handle("codex:start", () => codexClient.start());
ipcMain.handle("codex:send-message", (_event, text: string) => codexClient.sendMessage(text));
ipcMain.handle("codex:interrupt", () => codexClient.interrupt());
ipcMain.handle("codex:stop", () => codexClient.stop());
ipcMain.handle("codex:get-status", () => codexClient.getStatus());
