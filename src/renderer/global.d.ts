import type { CodexDesktopApi } from "../shared/codex.js";

declare global {
  interface Window {
    codexDesktop: CodexDesktopApi;
  }
}

export {};
