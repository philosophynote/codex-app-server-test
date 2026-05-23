# AGENTS.md

## プロジェクト概要

このディレクトリは、Codex app-server を TypeScript から試すための検証用プロジェクトです。

## 実行環境

- Node.js はプロジェクトローカルの `node@24.16.0` を使う。
- 依存関係の追加が必要な場合は、事前にユーザーへ確認する。
- Python は原則使わない。必要な場合は `uv` 経由で実行する。

## よく使うコマンド

```bash
npm run node:version
npm run typecheck
npm run dev
npm run start
npm run make
npm run app-server:ws
npm run generate:schema
```

## 開発ルール

- 変更は小さく保ち、既存の構成と命名に合わせる。
- TypeScript は `strict` 前提で書く。
- 変更後はまず `npm run typecheck` を実行する。
- 生成済みの `schemas/` は `codex app-server generate-ts --out ./schemas` の出力として扱う。
- `schemas/`、`.vite/`、`node_modules/`、`.serena/` はGit管理対象外として扱う。
- シークレットや個人情報をコード、ログ、READMEに書かない。

## Codex app-server

- stdio transport の検証は `npm run start` を使う。
- WebSocket transport の起動は `npm run app-server:ws` を使う。
- WebSocket起動後は `http://127.0.0.1:4500/readyz` または `http://127.0.0.1:4500/healthz` で状態確認する。
