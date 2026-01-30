# ドキュメントAI機能 - 将来構想

## 概要

NotebookLMのような「ドキュメントを投入して、その内容から正確に回答するAI機能」の実装可能性について。

## 要件

- ドキュメント（Excel/Word/PDF）をアップロード
- 全文を読み込み、取りこぼしなく情報を抽出
- 数を数える、集計するなど**正確な計算**が必要
- RAG（類似度検索）ではなく**全文コンテキスト処理**

## 推奨アーキテクチャ

### Azure OpenAI Assistants API + Code Interpreter

```
[Excel/Word/PDF] → [アップロード]
        ↓
[Azure OpenAI Assistants API]
   ├── ドキュメント解析
   ├── Pythonコード自動生成
   └── サンドボックスで実行
        ↓
[正確な数値結果]
```

### 必要なAzureサービス

| サービス | 用途 | 状態 |
|---------|------|------|
| Azure OpenAI (GPT-4o) | AI分析・コード生成 | 契約済み |
| Azure Blob Storage | ドキュメント保存 | 契約済み |
| Azure Document Intelligence | PDF/Office解析（オプション） | 未契約 |

## Code Interpreterのメリット

| 処理 | GPT単体 | Code Interpreter |
|------|---------|------------------|
| 合計計算 | 概算（誤差あり） | Pythonで正確 |
| 件数カウント | 数え間違いリスク | len()で正確 |
| Excel集計 | 推測 | pandas.sum()で正確 |
| データ抽出 | 取りこぼしリスク | 構造化処理で確実 |

## 実装例（Assistants API）

```python
from openai import AzureOpenAI

client = AzureOpenAI(
    azure_endpoint="https://your-endpoint.openai.azure.com/",
    api_key="your-key",
    api_version="2024-05-01-preview"
)

# Code Interpreter有効化
assistant = client.beta.assistants.create(
    model="gpt-4o",
    tools=[{"type": "code_interpreter"}],
    instructions="アップロードされたドキュメントを分析し、正確な計算を行ってください。"
)

# ファイルアップロード
file = client.files.create(
    file=open("report.xlsx", "rb"),
    purpose="assistants"
)

# スレッド作成・質問
thread = client.beta.threads.create()
message = client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="このExcelの合計件数と、カテゴリ別の内訳を教えてください",
    attachments=[{"file_id": file.id, "tools": [{"type": "code_interpreter"}]}]
)

# 実行
run = client.beta.threads.runs.create_and_poll(
    thread_id=thread.id,
    assistant_id=assistant.id
)

# 結果取得
messages = client.beta.threads.messages.list(thread_id=thread.id)
print(messages.data[0].content[0].text.value)
```

## UI実装案

### 統括・調整班ページへの統合

1. **左カラム**: ドキュメントアップロードエリア（ドラッグ&ドロップ）
2. **チャットパネル**: アップロードしたドキュメントについて質問
3. **結果表示**: 正確な数値・表形式で回答

### スタンドアロンページ

- `/user/command/documents` - ドキュメントAI専用ページ
- アップロード → 質問 → 正確な回答

## コスト見積もり

- Azure OpenAI GPT-4o: 入力 $2.50/1M tokens, 出力 $10/1M tokens
- Code Interpreter: 追加料金なし（Assistants APIに含まれる）
- ファイルストレージ: $0.20/GB/日

## 制約事項

- GPT-4oコンテキスト: 最大128Kトークン（約300ページ相当）
- 大きなファイルは分割処理が必要
- Code Interpreterのサンドボックスは一時的（セッション終了で消える）

## 優先度

- **現時点**: 実装見送り
- **将来**: 訓練後のフィードバックを踏まえて再検討

## 参考

- [Azure OpenAI Assistants API](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/assistant)
- [Code Interpreter](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/code-interpreter)
- [NotebookLM](https://notebooklm.google/) - Googleの類似サービス（API非公開）

---

作成日: 2026-01-31
