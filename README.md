# DMAT ChronologyAI

災害医療チーム（DMAT）向けのリアルタイムクロノロジー自動生成システム

> **IMPORTANT / 重要**
>
> Azureリソースは **`dmatAI` リソースグループ内のみ** で操作すること。
>
> **他のリソースグループへのアクセス・変更は絶対に禁止。**

## 概要

Zoom会議の音声をリアルタイムで文字起こしし、発言を自動分類・要約してクロノロジー（時系列記録）を生成するシステムです。

## Phase 1（MVP）機能

- Zoom会議へのBot参加
- 10〜20秒間隔で音声→STT（Azure Speech Services）
- 無音フィルタ（無音区間はセグメント化しない）
- 音声ファイルのBlob保存（後からの確認・再処理用）
- セグメント保存（生ログ）
- クロノロジー行（イベント）自動生成（7種別）
- Zoomユーザーネームから本部名を自動識別
- 管理UI（セッション管理・クロノロジー表示）

## 種別（7種類）

| 種別 | 説明 | 判定キーワード例 |
|------|------|------------------|
| 指示 | 上位→下位への命令 | 「してください」「指示します」 |
| 依頼 | 横の連携、お願い | 「お願いします」「依頼」 |
| 報告 | 状況共有 | 「報告します」「完了」「現状」 |
| 決定 | 合意・決定事項 | 「決定」「とします」 |
| 確認 | 質問・確認 | 「ですか？」「確認」 |
| リスク | 問題・懸念 | 「問題」「リスク」「懸念」 |
| その他 | 上記に該当しない | - |

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    Azure (DMAT-ChronologyAI)                │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Container    │    │ Azure Speech │    │ Azure OpenAI │  │
│  │ Apps (Bot)   │───▶│   (STT)      │    │  (分類/要約)  │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                                       ▲          │
│         ▼                                       │          │
│  ┌──────────────┐                        ┌──────────────┐  │
│  │ Blob Storage │                        │ FastAPI      │  │
│  │ (JSON+音声)  │◀──────────────────────▶│ Backend      │  │
│  └──────────────┘                        └──────────────┘  │
│                                                 ▲          │
│                                                 │WebSocket │
│                                          ┌──────────────┐  │
│                                          │ Next.js      │  │
│                                          │ Frontend     │  │
│                                          └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 技術スタック

| 領域 | 技術 | 備考 |
|------|------|------|
| Zoom連携 | Zoom Meeting SDK | 音声取得 |
| STT | Azure Speech Services | 音声→テキスト |
| AI | Azure OpenAI | GPT-4o（種別分類・要約） |
| DB | Azure Blob Storage | JSON形式で保存 |
| Backend | FastAPI (Python) | Azure SDKとの親和性 |
| Frontend | Next.js | React + TypeScript |
| リアルタイム | WebSocket | クロノロジー即時反映 |
| ホスティング | Azure Container Apps | Bot稼働 |

## ディレクトリ構成

```
ChronologyAI/
├── README.md
├── backend/                    # FastAPI バックエンド
│   ├── app/
│   │   ├── main.py            # エントリーポイント
│   │   ├── api/               # APIルーター
│   │   │   ├── sessions.py    # セッション管理
│   │   │   ├── chronology.py  # クロノロジー
│   │   │   ├── participants.py # 参加者管理
│   │   │   └── settings.py    # 設定（Zoom API等）
│   │   ├── services/          # ビジネスロジック
│   │   │   ├── zoom_bot.py    # Zoom Bot
│   │   │   ├── stt.py         # Azure Speech Services
│   │   │   ├── classifier.py  # 種別分類（Azure OpenAI）
│   │   │   ├── storage.py     # Blob Storage操作
│   │   │   └── silence_filter.py # 無音フィルタ
│   │   ├── models/            # Pydanticモデル
│   │   └── websocket/         # WebSocket管理
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                   # Next.js フロントエンド
│   ├── src/
│   │   ├── app/               # App Router
│   │   │   ├── page.tsx       # ホーム（セッション一覧）
│   │   │   ├── sessions/
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx        # セッション画面
│   │   │   │       └── chronology/
│   │   │   │           └── page.tsx    # クロノロジー画面
│   │   │   └── settings/
│   │   │       └── page.tsx   # 設定画面
│   │   ├── components/        # UIコンポーネント
│   │   └── lib/               # ユーティリティ
│   ├── package.json
│   └── Dockerfile
├── config/                     # 設定ファイル
│   ├── hq_master.json         # 本部マスタ
│   └── zoom_credentials.json  # Zoom API設定
├── docker-compose.yml
└── infrastructure/            # Azureインフラ
    └── deploy.sh              # デプロイスクリプト
```

## データ構造

### セッション（sessions/{session_id}/）

```
sessions/{session_id}/
├── meta.json              # セッション情報
├── participants.json      # 参加者リスト
├── segments/              # 生ログ（STT結果）
│   └── {timestamp}.json
├── audio/                 # 音声ファイル
│   └── {timestamp}.wav
└── chronology/            # クロノロジー行
    └── {timestamp}.json
```

## Azureリソース

| サービス | リソース名 | 用途 |
|----------|------------|------|
| Resource Group | dmatAI | リソースグループ（既存） |
| Container Apps | dmat-bot | Zoom Bot |
| Speech Services | dmat-speech | STT |
| OpenAI | dmat-openai | 種別分類・要約 |
| Blob Storage | dmatstorage | データ保存 |
| Static Web Apps | dmat-frontend | フロントエンド |

> **注意**: すべてのリソースは `dmatAI` リソースグループ内に作成すること

## セットアップ

### 1. Azureリソース作成

```bash
# リソースグループは既存の dmatAI を使用（作成不要）

# Azure Speech Services
az cognitiveservices account create \
  --name dmat-speech \
  --resource-group dmatAI \
  --kind SpeechServices \
  --sku S0 \
  --location japaneast

# Azure OpenAI
az cognitiveservices account create \
  --name dmat-openai \
  --resource-group dmatAI \
  --kind OpenAI \
  --sku S0 \
  --location japaneast

# Blob Storage
az storage account create \
  --name dmatstorage \
  --resource-group dmatAI \
  --location japaneast \
  --sku Standard_LRS

az storage container create \
  --name sessions \
  --account-name dmatstorage
```

### 2. ローカル開発

```bash
# バックエンド
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# フロントエンド
cd frontend
npm install
npm run dev
```

### 3. Zoom API設定

1. [Zoom App Marketplace](https://marketplace.zoom.us/) にアクセス
2. 「Build App」→「Server-to-Server OAuth」を選択
3. 必要なスコープを有効化：
   - `meeting:read`
   - `meeting:write`
   - `user:read`
4. 管理UIの設定画面から認証情報を入力

## 非機能要件

- **遅延**: 発言→クロノロジー表示まで20秒以内
- **同時接続**: 10〜20本部程度
- **データ保持**: セッション終了後も参照可能

## MVP完了の定義

- [ ] Zoom会議にBotが参加できる
- [ ] 音声がSTTでテキスト化される
- [ ] 無音区間がフィルタされる
- [ ] 音声ファイルがBlobに保存される
- [ ] セグメント（生ログ）が保存される
- [ ] クロノロジー行が自動生成される（7種別）
- [ ] 本部がZoomユーザーネームから自動識別される
- [ ] 管理UIでセッション一覧が見られる
- [ ] 管理UIでクロノロジーがリアルタイム表示される
- [ ] 管理UIで本部紐づけを修正できる
- [ ] Zoom API設定をUIから入力できる

## ライセンス

Private

## GitHub

https://github.com/NikoToRA/DMATchronologyAI
