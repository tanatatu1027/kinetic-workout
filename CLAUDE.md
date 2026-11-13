# 筋トレアプリ（kinetic-workout）

個人用の筋トレ記録・トレーニングアプリ（PWA）。

## 技術構成
- React 19 + TypeScript + Vite 8 + vite-plugin-pwa
- three.js（3D表示）、フォント: Orbitron / Rajdhani / JetBrains Mono
- 開発: `npm run dev`（`--host`付き）／ビルド: `npm run build`／アイコン生成: `npm run icons`

## ファイル構成
- `src/App.tsx`, `src/main.tsx` — エントリ
- `src/screens/` 画面、`src/components/` 部品、`src/data/` 種目などのデータ、`src/lib/` 共通処理、`src/types.ts` 型定義
- `src/data/guides.ts` 種目ガイド（使う筋肉・やり方・注意点）、`src/components/ExerciseGuide.tsx` 動きの写真表示
- `public/exercises/<種目ID>/0.jpg, 1.jpg` 種目の開始・終了写真（free-exercise-db、Unlicense）。取得は `node scripts/fetch-exercise-images.mjs`
- `public/` 静的ファイル、`scripts/make-icons.mjs` アイコン生成
- `dist/` はビルド成果物（手で編集しない）

## クラウドバックアップ
- Supabase（プロジェクト kinetic-workout）へ自動保存。ログイン不要で、端末が作る「合言葉」（20文字）のハッシュが保存先の名前になる。
- `src/lib/cloud.ts`（送受信・自動実行）、`src/lib/cloud-config.ts`（URLと公開キー）、`src/components/CloudBackup.tsx`（設定画面）、`supabase/kinetic-backup.sql`（テーブルと関数。SQL Editorで実行済み）。
- テーブルへの直接アクセスは禁止。`kinetic_save` / `kinetic_load` の2関数だけで読み書きする。1日1件・直近7日を保持。

## 守るルール
- 変更後は `npm run dev` でブラウザ表示を確認する（親フォルダの開発ルールに従う）。
- `dist/` と `node_modules/` は編集しない。
- 型エラーを残さない（`tsc -b` が通ること）。

## 完成の基準
- `npm run build` がエラーなく通る。
- 変更した画面をブラウザで実際に操作して確認済み。
- スマホ表示の確認は、ユーザーが指示したときだけ行う。
