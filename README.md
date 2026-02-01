# DynamoDB Scan vs Query - 商品カタログ検索

ECサイトの商品カタログを題材に、DynamoDBのScan（FilterExpression使用）とQuery（GSI使用）のパフォーマンス・コスト比較を検証するプロジェクトです。

## 概要

ECサイトでよくある「カテゴリ別商品一覧」を取得する際の2つのアプローチを比較します：

1. **Scan + FilterExpression**: 全商品をスキャンして、カテゴリでフィルタリング
2. **Query + GSI**: カテゴリ用のGSIを使用して、該当商品に直接アクセス

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│           DynamoDB Tables: Products-{100,1000,...}          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Primary Key: id (UUID)                              │    │
│  │  Attributes: category, createdAt, name, price, desc  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  GSI: category-name-index                            │    │
│  │  Partition Key: category                             │    │
│  │  Sort Key: name (商品名でソート)                      │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘

Lambda Functions:
  - generate-products: 指定件数の商品データを生成
  - test-scan: Scan + FilterExpressionで指定カテゴリを検索
  - test-query: Query (GSI)で指定カテゴリを検索
```

## データサイズ

複数のデータサイズでベンチマークを実行できるよう、以下のテーブルが作成されます：

| テーブル名 | データ件数 |
|-----------|-----------|
| Products-100 | 100件 |
| Products-1000 | 1,000件 |
| Products-10000 | 10,000件 |
| Products-100000 | 100,000件 |
| Products-1000000 | 1,000,000件 |

## データ構造

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | String | UUID（プライマリキー） |
| category | String | 商品カテゴリ（GSIパーティションキー） |
| name | String | 商品名（GSIソートキー） |
| createdAt | Number | Unixタイムスタンプ（ミリ秒） |
| price | Number | 価格（100〜10099円） |
| description | String | 商品説明（約1KB） |

## カテゴリ分布

| カテゴリ | 割合 | 備考 |
|---------|------|------|
| 電子機器 | 30% | デフォルト検索対象 |
| 衣類 | 25% | |
| 書籍 | 25% | |
| 食品 | 20% | |

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

Lambda関数を直接invokeしてデータを生成します：

```bash
# 1,000件のデータを生成する例
aws lambda invoke \
  --function-name BenchmarkStack-GenerateProductsFunction \
  --payload '{"tableName": "Products-1000", "totalItems": 1000}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout

# 100,000件のデータを生成する例
aws lambda invoke \
  --function-name BenchmarkStack-GenerateProductsFunction \
  --payload '{"tableName": "Products-100000", "totalItems": 100000}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout
```

出力例:
```json
{
  "success": true,
  "totalProducts": 1000,
  "categoryBreakdown": {
    "電子機器": 300,
    "衣類": 250,
    "書籍": 250,
    "食品": 200
  },
  "durationMs": 5432,
  "tableName": "Products-1000"
}
```

### 4. ベンチマーク実行

```bash
# Scan + FilterExpressionのベンチマーク
aws lambda invoke \
  --function-name BenchmarkStack-TestScanFunction \
  --payload '{"tableName": "Products-1000", "category": "電子機器"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout

# Query (GSI)のベンチマーク
aws lambda invoke \
  --function-name BenchmarkStack-TestQueryFunction \
  --payload '{"tableName": "Products-1000", "category": "電子機器"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout
```

ログの確認：
```bash
# Scanのログを確認
pnpm run show-logs-scan

# Queryのログを確認
pnpm run show-logs-query
```

### 5. クリーンアップ

```bash
pnpm run destroy
```

## 期待される出力形式

### Scan結果
```json
{
  "operation": "scan",
  "tableName": "Products-1000",
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
  "tableName": "Products-1000",
  "targetCategory": "電子機器",
  "responseTimeMs": 78,
  "consumedRCU": 35.0,
  "scannedCount": 300,
  "returnedCount": 300,
  "pageCount": 1
}
```

## 期待される比較結果

| 指標 | Scan | Query | 改善率 |
|------|------|-------|--------|
| レスポンス時間 | ~245ms | ~78ms | **約3倍高速** |
| 消費RCU | ~115 | ~35 | **約70%削減** |
| スキャン件数 | 全件 | 該当カテゴリのみ | **70%削減** |

## なぜQueryの方が効率的なのか

### Scanの動作
1. 商品テーブル全体を読み取る
2. 読み取り後にFilterExpressionで該当カテゴリ以外を除外
3. **RCUは全件分消費される**（フィルターは読み取り後に適用）

### Queryの動作
1. GSI `category-name-index` を使用して該当カテゴリのパーティションに直接アクセス
2. 該当する商品のみを読み取る
3. **RCUは該当件数分のみ消費**

```
┌─────────────────────────────────────────────────────────────┐
│  Scan: テーブル全体を走査してからフィルター                    │
│  ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐                 │
│  │ 電│ 衣│ 書│ 食│ 電│ 衣│ 書│ 電│ 食│...│  → 全件読み取り  │
│  └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘                 │
│                    ↓ FilterExpression                       │
│              30%返却（でもRCUは全件分）                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Query: GSIで該当パーティションに直接アクセス                  │
│  ┌───────────────────┐                                      │
│  │ 電子機器 (30%)    │ ← 直接アクセス                        │
│  └───────────────────┘                                      │
│              30%返却（RCUも30%分）                            │
└─────────────────────────────────────────────────────────────┘
```

## ファイル構成

```
dynamodb-scan-vs-query-benchmark/
├── bin/
│   └── app.ts                    # CDKエントリーポイント
├── lib/
│   └── benchmark-stack.ts        # CDKスタック定義
├── functions/
│   ├── generate-products.ts      # 商品データ生成Lambda
│   ├── test-scan.ts              # Scanベンチマーク Lambda
│   └── test-query.ts             # Queryベンチマーク Lambda
├── cdk.json
├── package.json
├── tsconfig.json
├── CLAUDE.md                     # Claude Code用プロジェクト説明
└── README.md
```

## 注意事項

- このプロジェクトは検証用途のため、テーブルの`RemovalPolicy`は`DESTROY`に設定されています
- デプロイ先のAWSアカウントに課金が発生する可能性があります
- 大量データ（100,000件以上）の生成には時間がかかります
- 使用後は必ず`pnpm run destroy`でリソースを削除してください
