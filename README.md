# DynamoDB Scan vs Query - 商品カタログ検索

ECサイトの商品カタログを題材に、DynamoDBのScan（FilterExpression使用）とQuery（GSI使用）のパフォーマンス・コスト比較を検証するプロジェクトです。

## 概要

ECサイトでよくある「カテゴリ別商品一覧」を取得する際の2つのアプローチを比較します：

1. **Scan + FilterExpression**: 全商品をスキャンして、カテゴリでフィルタリング
2. **Query + GSI**: カテゴリ用のGSIを使用して、該当商品に直接アクセス

**検証軸**:
- データ件数（100 〜 1,000,000件）
- レコードサイズ（0.5KB, 1KB, 5KB）

## テーブル構成

データ件数 × レコードサイズの組み合わせで15テーブルが作成されます：

| データ件数  | 0.5KB                  | 1KB                  | 5KB                  |
| ----------- | ---------------------- | -------------------- | -------------------- |
| 100件       | Products-100-0.5kb     | Products-100-1kb     | Products-100-5kb     |
| 1,000件     | Products-1000-0.5kb    | Products-1000-1kb    | Products-1000-5kb    |
| 10,000件    | Products-10000-0.5kb   | Products-10000-1kb   | Products-10000-5kb   |
| 100,000件   | Products-100000-0.5kb  | Products-100000-1kb  | Products-100000-5kb  |
| 1,000,000件 | Products-1000000-0.5kb | Products-1000000-1kb | Products-1000000-5kb |

## データ構造

| フィールド  | 型     | 説明                                             |
| ----------- | ------ | ------------------------------------------------ |
| id          | String | UUID（プライマリキー）                           |
| category    | String | 商品カテゴリ（GSIパーティションキー）            |
| name        | String | 商品名（GSIソートキー）                          |
| createdAt   | Number | Unixタイムスタンプ（ミリ秒）                     |
| price       | Number | 価格（100〜10099円）                             |
| description | String | 商品説明（レコードサイズに応じて約0.35〜4.85KB） |

## カテゴリ分布

| カテゴリ | 割合 | 備考               |
| -------- | ---- | ------------------ |
| 電子機器 | 30%  | デフォルト検索対象 |
| 衣類     | 25%  |                    |
| 書籍     | 25%  |                    |
| 食品     | 20%  |                    |

## 前提条件

- Node.js 24以上
- pnpm
- AWS CLI設定済み
- CDK Bootstrap済み（初回のみ `cdk bootstrap` 実行）

## 使い方

### 1. セットアップ

```bash
pnpm install
```

### 2. デプロイ

```bash
# 初回のみ
cdk bootstrap

# スタックをデプロイ
pnpm run deploy
```

### 3. 商品データ生成

ローカルスクリプトでデータを生成します：

```bash
# 全テーブルにデータを生成
pnpm run generate-local

# 特定のテーブルのみ（件数、レコードサイズを指定）
pnpm run generate-local 1000 1      # 1000件、1KB
pnpm run generate-local 10000 0.5   # 10000件、0.5KB

# 途中から再開（件数、レコードサイズ、開始位置を指定）
pnpm run generate-local 1000000 1 935000
```

### 4. ベンチマーク実行

```bash
# 全テーブルに対して一括実行（5回×ウォームアップ付き）
./scripts/testing.sh

# 個別実行（Scan）
aws lambda invoke \
  --function-name BenchmarkStack-TestScanFunction \
  --payload '{"tableName": "Products-1000-1kb", "category": "電子機器"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout

# 個別実行（Query）
aws lambda invoke \
  --function-name BenchmarkStack-TestQueryFunction \
  --payload '{"tableName": "Products-1000-1kb", "category": "電子機器"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout
```

### 5. 結果の確認

```bash
# CloudWatchログから結果を集計（デフォルト: 過去2時間）
./scripts/analyze-logs.sh

# 期間を指定して集計
./scripts/analyze-logs.sh 24h

# 個別のログを確認
pnpm run show-logs-scan   # Scanのログ
pnpm run show-logs-query  # Queryのログ
```

### 6. クリーンアップ

```bash
pnpm run destroy
```

## 期待される出力形式

### Scan結果

```json
{
  "operation": "scan",
  "tableName": "Products-1000-1kb",
  "targetCategory": "電子機器",
  "responseTimeMs": 245,
  "consumedRCU": 115.5,
  "scannedCount": 1000,
  "returnedCount": 300,
  "pageCount": 1
}
```

### Query結果

```json
{
  "operation": "query",
  "tableName": "Products-1000-1kb",
  "targetCategory": "電子機器",
  "responseTimeMs": 78,
  "consumedRCU": 35.0,
  "scannedCount": 300,
  "returnedCount": 300,
  "pageCount": 1
}
```

## ファイル構成

```
dynamodb-scan-vs-query-benchmark/
├── bin/
│   └── app.ts                       # CDKエントリーポイント
├── lib/
│   └── benchmark-stack.ts           # CDKスタック定義
├── functions/
│   ├── test-scan.ts                 # Scanベンチマーク Lambda
│   └── test-query.ts                # Queryベンチマーク Lambda
├── scripts/
│   ├── generate-products-local.ts   # 商品データ生成（ローカル実行）
│   ├── testing.sh                   # ベンチマーク一括実行
│   └── analyze-logs.sh              # 結果集計スクリプト
├── cdk.json
├── package.json
├── tsconfig.json
├── CLAUDE.md                        # Claude Code用プロジェクト説明
└── README.md
```

## 注意事項

- このプロジェクトは検証用途のため、テーブルの`RemovalPolicy`は`DESTROY`に設定されています
- デプロイ先のAWSアカウントに課金が発生する可能性があります
- 大量データ（100,000件以上）の生成には時間がかかります
- 使用後は必ず`pnpm run destroy`でリソースを削除してください
