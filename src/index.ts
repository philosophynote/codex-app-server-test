import { spawn } from "node:child_process";
import readline from "node:readline";

type JsonRpcMessage = {
  id?: number;
  method?: string;
  result?: {
    thread?: {
      id?: string;
    };
  };
  error?: {
    code: number;
    message: string;
  };
};

const proc = spawn("codex", ["app-server"], {
  stdio: ["pipe", "pipe", "inherit"],
});

const lines = readline.createInterface({ input: proc.stdout });

const send = (message: unknown) => {
  proc.stdin.write(`${JSON.stringify(message)}\n`);
};

let threadId: string | null = null;

lines.on("line", (line) => {
  const message = JSON.parse(line) as JsonRpcMessage;
  console.log("server:", message);

  if (message.id === 1 && message.result?.thread?.id && threadId === null) {
    threadId = message.result.thread.id;
    send({
      method: "turn/start",
      id: 2,
      params: {
        threadId,
        input: [{ type: "text", text: "このリポジトリを短く要約してください。" }],
      },
    });
  }
});

proc.on("exit", (code, signal) => {
  console.log("codex app-server exited:", { code, signal });
});

send({
  method: "initialize",
  id: 0,
  params: {
    clientInfo: {
      name: "codex_app_server_test",
      title: "Codex App Server Test",
      version: "0.1.0",
    },
  },
});
send({ method: "initialized", params: {} });
send({ method: "thread/start", id: 1, params: { model: "gpt-5.4" } });
