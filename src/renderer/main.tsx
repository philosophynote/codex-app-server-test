import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  ChatMessage,
  CodexEvent,
  CodexLogEntry,
  CodexRuntimeStatus,
} from "../shared/codex.js";
import "./styles.css";

const initialStatus: CodexRuntimeStatus = {
  status: "停止中",
  cwd: "",
  model: "gpt-5.4",
  threadId: null,
  turnId: null,
};

const createMessage = (role: ChatMessage["role"], text: string): ChatMessage => ({
  id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  role,
  text,
  status: "done",
});

const App = (): React.JSX.Element => {
  const [status, setStatus] = useState<CodexRuntimeStatus>(initialStatus);
  const [messages, setMessages] = useState<ChatMessage[]>([
    createMessage("system", "Codex app-server に接続しています。"),
  ]);
  const [logs, setLogs] = useState<CodexLogEntry[]>([]);
  const [input, setInput] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const isBusy = status.status === "起動中" || status.status === "実行中";
  const canSend = status.status === "準備完了" && input.trim().length > 0;

  const activeThreadLabel = useMemo(() => {
    if (status.threadId === null) {
      return "未接続";
    }
    return status.threadId.slice(0, 12);
  }, [status.threadId]);

  useEffect(() => {
    const unsubscribe = window.codexDesktop.onEvent((event) => {
      applyCodexEvent(event);
    });

    void window.codexDesktop.getStatus().then(setStatus);
    void window.codexDesktop.start().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Codex の起動に失敗しました。";
      setErrorText(message);
      setMessages((current) => [...current, createMessage("system", message)]);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const applyCodexEvent = (event: CodexEvent): void => {
    if (event.type === "status") {
      setStatus(event.payload);
      return;
    }

    if (event.type === "assistant-start") {
      setMessages((current) => [
        ...current,
        {
          id: event.payload.messageId,
          role: "assistant",
          text: "",
          status: "streaming",
        },
      ]);
      return;
    }

    if (event.type === "assistant-delta") {
      setMessages((current) =>
        current.map((message) =>
          message.id === event.payload.messageId
            ? { ...message, text: `${message.text}${event.payload.delta}`, status: "streaming" }
            : message,
        ),
      );
      return;
    }

    if (event.type === "assistant-complete") {
      setMessages((current) =>
        current.map((message) =>
          message.id === event.payload.messageId ? { ...message, status: "done" } : message,
        ),
      );
      return;
    }

    if (event.type === "log") {
      setLogs((current) => [event.payload, ...current].slice(0, 80));
      return;
    }

    if (event.type === "error") {
      setErrorText(event.payload.message);
      setMessages((current) => [...current, createMessage("system", event.payload.message)]);
    }
  };

  const sendMessage = async (): Promise<void> => {
    const text = input.trim();
    if (text.length === 0 || !canSend) {
      return;
    }

    setErrorText(null);
    setInput("");
    setMessages((current) => [...current, createMessage("user", text)]);

    try {
      await window.codexDesktop.sendMessage(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : "メッセージ送信に失敗しました。";
      setErrorText(message);
      setMessages((current) => [...current, createMessage("system", message)]);
    }
  };

  const interrupt = async (): Promise<void> => {
    try {
      await window.codexDesktop.interrupt();
    } catch (error) {
      const message = error instanceof Error ? error.message : "停止に失敗しました。";
      setErrorText(message);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">C</div>
          <div>
            <h1>Codex Local Chat</h1>
            <p>{status.status}</p>
          </div>
        </div>

        <button className="new-thread-button" type="button" disabled>
          新規チャット
        </button>

        <div className="thread-list" aria-label="スレッド一覧">
          <button className="thread-item active" type="button">
            <span>Local thread</span>
            <small>{activeThreadLabel}</small>
          </button>
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <strong>{status.cwd || "準備中"}</strong>
          </div>
          <div className={`status-pill ${status.status === "エラー" ? "danger" : ""}`}>
            {status.status}
          </div>
        </header>

        <section className="message-list" aria-label="チャット">
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="message-meta">
                <span>{message.role === "assistant" ? "Codex" : message.role === "user" ? "お兄ちゃん" : "System"}</span>
                {message.status === "streaming" ? <small>入力中</small> : null}
              </div>
              <p>{message.text || "..."}</p>
            </article>
          ))}
          <div ref={messagesEndRef} />
        </section>

        <footer className="composer">
          {errorText !== null ? <div className="error-banner">{errorText}</div> : null}
          <div className="composer-row">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Codex に依頼する内容を書く"
              rows={3}
              disabled={status.status === "起動中" || status.status === "エラー"}
            />
            {status.status === "実行中" ? (
              <button className="secondary-button" type="button" onClick={() => void interrupt()}>
                停止
              </button>
            ) : (
              <button className="primary-button" type="button" disabled={!canSend} onClick={() => void sendMessage()}>
                送信
              </button>
            )}
          </div>
        </footer>
      </main>

      <aside className="detail-panel">
        <section>
          <h2>接続</h2>
          <dl className="status-grid">
            <div>
              <dt>状態</dt>
              <dd>{status.status}</dd>
            </div>
            <div>
              <dt>モデル</dt>
              <dd>{status.model}</dd>
            </div>
            <div>
              <dt>Thread</dt>
              <dd>{status.threadId ?? "-"}</dd>
            </div>
            <div>
              <dt>Turn</dt>
              <dd>{status.turnId ?? "-"}</dd>
            </div>
          </dl>
        </section>

        <section className="log-section">
          <h2>ログ</h2>
          <div className="log-list">
            {logs.length === 0 ? (
              <p className="empty-log">まだログはありません。</p>
            ) : (
              logs.map((log) => (
                <div className={`log-entry ${log.level}`} key={log.id}>
                  <time>{log.timestamp}</time>
                  <span>{log.text}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </aside>
    </div>
  );
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
