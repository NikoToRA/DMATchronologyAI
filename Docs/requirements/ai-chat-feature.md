# AIチャット機能 要件定義書

## 概要
物資支援班ページ（2026年DMAT関東ブロック訓練用）にAIチャット機能を追加する。
クロノロジーの内容を参照しながらAIと対話し、状況把握・意思決定を支援する。

---

## 機能要件

### 1. UIボタン配置

| ボタン | 場所 | 機能 |
|--------|------|------|
| AIチャット | ヘッダー右上 | チャットパネルを開閉 |
| 現状評価と分析 | ヘッダー右上 | 現状分析パネルを開閉（Phase 2） |

**配置イメージ:**
```
[物資支援班]          [本部名] [接続状態] [AIチャット] [分析] [ログアウト]
```

### 2. AIチャットパネル

#### 2.1 表示仕様
- **タイプ:** オーバーレイ（右サイドパネル）
- **幅:** 400px（レスポンシブ対応）
- **高さ:** 画面上部〜発話ボタンの上端まで
- **位置:** 画面右端に固定
- **アニメーション:** 右からスライドイン
- **背景:** 半透明オーバーレイ（閉じるクリック対応）

#### 2.2 パネル構成
```
┌─────────────────────────────────┐
│ [×] AIアシスタント              │  ← ヘッダー
├─────────────────────────────────┤
│ スレッド選択: [新規] [履歴▼]    │  ← スレッド管理
├─────────────────────────────────┤
│                                 │
│   メッセージ表示エリア          │  ← チャット履歴
│   (スクロール可能)              │
│                                 │
├─────────────────────────────────┤
│ [入力欄_______________] [送信]  │  ← 入力エリア
└─────────────────────────────────┘
```

### 3. チャット機能

#### 3.1 会話コンテキスト
- **自動注入:** 現在のクロノロジーエントリ一覧をAIコンテキストに含める
- **参照範囲:** 直近100件のエントリ（設定可能）
- **更新:** チャット開始時・手動更新ボタン

#### 3.2 スレッド管理
- **スレッド単位:** 1つの相談トピックを1スレッドで管理
- **履歴保持:** バックエンドDB（セッション全体で共有）
- **アクセス制御:**
  - **作成者:** 対話可能（メッセージ送信OK）
  - **他ユーザー:** 閲覧のみ（読み取り専用）
- **スレッド識別:** 作成した本部名で表示

**スレッド一覧の見え方:**
```
┌─────────────────────────────────────┐
│ スレッド一覧                         │
├─────────────────────────────────────┤
│ 📝 [本部A] 物資配送ルートの相談      │ ← 自分のスレッド（対話可能）
│ 👁 [本部B] 避難所の優先順位について   │ ← 他者のスレッド（閲覧のみ）
│ 👁 [本部C] 毛布の在庫確認            │ ← 他者のスレッド（閲覧のみ）
│ [+ 新規AI相談]                       │
└─────────────────────────────────────┘
```

#### 3.3 メッセージ構造
```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  chronologySnapshot?: string[];  // 参照したエントリID（オプション）
}

interface ChatThread {
  id: string;
  sessionId: string;
  creatorHqId: string;           // 作成者の本部ID
  creatorHqName: string;         // 作成者の本部名（表示用）
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

// アクセス権限
interface ThreadAccess {
  canWrite: boolean;  // true: 作成者, false: 他ユーザー
  canRead: boolean;   // 常にtrue（同一セッション内）
}
```

### 4. AI連携

#### 4.1 使用リソース
- **Azure OpenAI:** 既存のバックエンド設定を使用
- **モデル:** gpt-4o（既存のclassifier.pyと同じデプロイ）
- **エンドポイント:** 新規APIエンドポイントを追加

#### 4.2 プロンプト設計
```
システムプロンプト:
あなたは災害対応本部のAIアシスタントです。
物資支援班のクロノロジー（活動記録）を分析し、質問に回答します。

[コンテキスト]
- 災害名: {incidentName}
- 本部名: {hqName}
- セッションID: {sessionId}

[現在のクロノロジー]
{chronologyEntries}

ユーザーの質問に対し、上記コンテキストを参考に回答してください。
```

#### 4.3 APIエンドポイント

**スレッド一覧取得:**
```
GET /api/sessions/{sessionId}/chat/threads?hqId={hqId}

Response:
{
  "threads": [
    {
      "id": "uuid",
      "creatorHqId": "hq-001",
      "creatorHqName": "本部A",
      "title": "物資配送ルートの相談",
      "createdAt": "2026-01-26T09:00:00Z",
      "updatedAt": "2026-01-26T09:15:00Z",
      "messageCount": 5,
      "canWrite": true  // リクエストしたhqIdが作成者なら true
    }
  ]
}
```

**スレッド詳細取得（メッセージ含む）:**
```
GET /api/sessions/{sessionId}/chat/threads/{threadId}?hqId={hqId}

Response:
{
  "thread": {
    "id": "uuid",
    "creatorHqId": "hq-001",
    "creatorHqName": "本部A",
    "title": "物資配送ルートの相談",
    "canWrite": true,
    "messages": [...]
  }
}
```

**メッセージ送信（作成者のみ）:**
```
POST /api/sessions/{sessionId}/chat/threads/{threadId}/messages
Request:
{
  "hqId": string,              // 送信者の本部ID（認証用）
  "message": string,
  "includeChronology": boolean
}

Response:
{
  "message": {
    "id": string,
    "role": "assistant",
    "content": string,
    "timestamp": string
  }
}

Error (403):
{
  "error": "このスレッドへの書き込み権限がありません"
}
```

**新規スレッド作成:**
```
POST /api/sessions/{sessionId}/chat/threads
Request:
{
  "hqId": string,              // 作成者の本部ID
  "hqName": string,            // 作成者の本部名
  "message": string,           // 最初のメッセージ
  "includeChronology": boolean
}

Response:
{
  "thread": {
    "id": "uuid",
    "creatorHqId": "hq-001",
    "creatorHqName": "本部A",
    "title": "自動生成タイトル",
    "canWrite": true
  },
  "message": {
    "id": string,
    "role": "assistant",
    "content": string,
    "timestamp": string
  }
}
```

---

## 非機能要件

### パフォーマンス
- API応答: ストリーミング対応（SSE）で体感速度向上
- 初回応答: 2秒以内にトークン開始

### セキュリティ
- セッション認証必須
- 個人情報・患者情報のフィルタリング注意

### 可用性
- オフライン時: チャット機能非活性化（接続状態表示）
- エラー時: リトライ機能（3回まで）

---

## 技術仕様

### フロントエンド

#### 新規コンポーネント
```
/src/components/chat/
├── AIChatButton.tsx        # ヘッダーボタン
├── AIChatPanel.tsx         # メインパネル
├── ChatMessageList.tsx     # メッセージ一覧
├── ChatMessage.tsx         # 個別メッセージ
├── ChatInput.tsx           # 入力欄
├── ThreadSelector.tsx      # スレッド選択
└── index.ts
```

#### 新規Hooks
```
/src/hooks/
├── useAIChat.ts            # チャットロジック
└── useChatThreads.ts       # スレッド管理
```

#### State管理
- **チャットパネル開閉:** `useState<boolean>`
- **現在のスレッド:** `useState<ChatThread | null>`
- **スレッド一覧:** React Query（バックエンドから取得）
- **送信状態:** `useState<'idle' | 'sending' | 'streaming'>`
- **書き込み権限:** スレッドの`canWrite`フラグで制御

### バックエンド

#### 新規ファイル
```
/backend/app/
├── routes/chat.py          # チャットエンドポイント
└── services/chat_service.py # チャットロジック
```

#### DB
- **スレッドテーブル:** `chat_threads`
  - id, session_id, creator_hq_id, creator_hq_name, title, created_at, updated_at
- **メッセージテーブル:** `chat_messages`
  - id, thread_id, role, content, timestamp, chronology_snapshot

---

## 開発フェーズ

### Phase 1（今回の実装範囲）
1. [x] 要件定義
2. [ ] ヘッダーにAIチャットボタン追加
3. [ ] チャットパネルUI実装
4. [ ] バックエンドAPI実装（/api/sessions/{sessionId}/chat）
5. [ ] クロノロジーコンテキスト注入
6. [ ] スレッド管理（localStorage）
7. [ ] 基本的なエラーハンドリング

### Phase 2（将来実装）
- [ ] 現状評価と分析ボタン・機能
- [ ] ストリーミングレスポンス（SSE）
- [ ] スレッドのDB永続化
- [ ] 会話エクスポート機能
- [ ] 音声入力対応

---

## UI/UXモックアップ

### チャットパネル（開いた状態）
```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [Package] 物資支援班                    [本部A] [🟢] [💬 AI] [📊] [logout]      │
├────────────────────────────────────────────────────────────────┬─────────────────┤
│                                                                │ [×] AIアシスタント │
│  クロノロジー一覧                                               │                 │
│  ┌────────────────────────────────────┐                        │ スレッド: 新規会話 │
│  │ 09:15 [報告] 避難所Aへ物資到着      │                        │                 │
│  │ 09:10 [依頼] 毛布50枚追加要請       │                        │ ┌─────────────┐ │
│  │ 09:05 [指示] 物資配送ルート変更     │                        │ │ AI: どのよう │ │
│  └────────────────────────────────────┘                        │ │ なご質問です │ │
│                                                                │ │ か？        │ │
│                                                                │ └─────────────┘ │
│                                                                │                 │
│                                                                │ [入力欄] [送信]  │
│  ┌─────────────────────────────────────────┐                   └─────────────────┤
│  │ [🎤 録音開始]                           │                                     │
│  └─────────────────────────────────────────┘                                     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 承認

| 項目 | 担当 | 日付 |
|------|------|------|
| 要件定義作成 | Claude | 2026-01-26 |
| 要件レビュー | - | - |
| 実装開始承認 | - | - |
