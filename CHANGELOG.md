# Changelog

## [2025-01-24] Azure Container Apps スケール設定変更

### 変更内容
- **chronologyai-frontend**: minReplicas を 0 → 1 に変更
- **chronologyai-backend**: minReplicas を 0 → 1 に変更

### 目的
- コールドスタート問題の解消（初回アクセス時の30秒〜2分の遅延を解消）
- 2月7日までの訓練・運用期間中の快適な動作を確保

### 設定詳細
| Container App | minReplicas | maxReplicas | リージョン |
|---------------|-------------|-------------|-----------|
| chronologyai-frontend | 1 | 3 | Japan East |
| chronologyai-backend | 1 | 3 | Japan East |

### Azure リソース情報
- サブスクリプション: `c216cd0d-f9ff-464d-86aa-7f1304eb2e73` (dmat)
- リソースグループ: `dmatAI`

### 費用影響
- 約50〜60円/日の追加コスト（常時稼働のため）

### 戻し方（2月8日以降）
```bash
az account set --subscription c216cd0d-f9ff-464d-86aa-7f1304eb2e73
az containerapp update -g dmatAI -n chronologyai-frontend --min-replicas 0
az containerapp update -g dmatAI -n chronologyai-backend --min-replicas 0
```

### 動作確認
- [x] 設定変更完了
- [x] 動作確認済み
