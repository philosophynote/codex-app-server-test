# Codex Local Chat

ローカルの `codex app-server` を stdio で起動し、Electron + React のUIからチャットするための試作アプリです。

## 前提

- Node.js 24.16.0
- npm
- Codex CLI
- Codex CLI でのログイン済み認証情報

## セットアップ

```bash
npm install
npm run node:version
npm run typecheck
```

## 使い方

Electron アプリを開発モードで起動します。

```bash
npm run dev
```

CLI サンプルから stdio transport の app-server を起動する場合:

```bash
npm run start
```

WebSocket transport を直接起動する場合:

```bash
npm run app-server:ws
```

Codex app-server の TypeScript schema を生成する場合:

```bash
npm run generate:schema
```

生成された `schemas/` はGit管理対象外です。必要な環境で再生成してください。

## パッケージ作成

Electron Forge のmaker設定を使ってアプリを作成します。

```bash
npm run make
```

社内配付する場合は、配付先OSに合わせたコード署名、Notarization、MDM配布などを別途設定してください。

## 構成

- `src/main/`: Electron main process と `codex app-server` の stdio 管理
- `src/preload/`: Renderer に公開する安全なIPC API
- `src/renderer/`: React UI
- `src/shared/`: main / preload / renderer で共有する型

## GitHubに含めないもの

- `node_modules/`
- `.vite/`, `out/`, `dist/` などのビルド生成物
- `schemas/`
- `.env` などのローカル設定・シークレット
