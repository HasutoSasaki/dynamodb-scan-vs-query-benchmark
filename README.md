# DynamoDB Scan vs Query - 商品カタログ検索

ECサイトの商品カタログを題材に、DynamoDBのScan（FilterExpression使用）とQuery（GSI使用）のパフォーマンス・コスト比較を検証するプロジェクトです。

## 概要

ECサイトでよくある「カテゴリ別商品一覧」を取得する際の2つのアプローチを比較します：

1. **Scan + FilterExpression**: 全商品をスキャンして、カテゴリでフィルタリング
2. **Query + GSI**: カテゴリ用のGSIを使用して、該当商品に直接アクセス

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    DynamoDB Table: Products                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Primary Key: id (UUID)                              │    │
│  │  Attributes: category, createdAt, name, price, desc  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  GSI: category-index                                 │    │
│  │  Partition Key: category                             │    │
│  │  Sort Key: createdAt (新着順ソート用)                 │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘

Lambda Functions:
  - generate-products: 900件の商品データを生成
  - test-scan: Scan + FilterExpressionで「electronics」カテゴリを検索
  - test-query: Query (GSI)で「electronics」カテゴリを検索
```

## データ構造

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | String | UUID（プライマリキー） |
| category | String | 商品カテゴリ（GSIパーティションキー） |
| createdAt | String | ISO 8601タイムスタンプ（GSIソートキー） |
| name | String | 商品名 |
| price | Number | 価格（100〜10099円） |
| description | String | 商品説明（約1KB） |

## カテゴリ分布（900件）

| カテゴリ | 割合 | 件数 | 備考 |
|---------|------|------|------|
| electronics | 30% | 270件 | **検索対象** |
| clothing | 25% | 225件 | |
| books | 25% | 225件 | |
| food | 20% | 180件 | |

## 前提条件

- Node.js 20以上
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

```bash
pnpm run generate-products
```

出力例:
```json
{
  "success": true,
  "totalProducts": 900,
  "categoryBreakdown": {
    "electronics": 270,
    "clothing": 225,
    "books": 225,
    "food": 180
  },
  "durationMs": 5432,
  "tableName": "Products"
}
```

### 4. ベンチマーク実行

```bash
# Scan + FilterExpressionのベンチマーク
pnpm run test-scan

# Query (GSI)のベンチマーク
pnpm run test-query
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
  "targetCategory": "electronics",
  "responseTimeMs": 245,
  "consumedRCU": 115.5,
  "scannedCount": 900,
  "returnedCount": 270,
  "pageCount": 1
}
```

### Query結果
```json
{
  "operation": "query",
  "targetCategory": "electronics",
  "responseTimeMs": 78,
  "consumedRCU": 35.0,
  "scannedCount": 270,
  "returnedCount": 270,
  "pageCount": 1
}
```

## 期待される比較結果

| 指標 | Scan | Query | 改善率 |
|------|------|-------|--------|
| レスポンス時間 | ~245ms | ~78ms | **約3倍高速** |
| 消費RCU | ~115 | ~35 | **約70%削減** |
| スキャン件数 | 900件 | 270件 | **70%削減** |

## なぜQueryの方が効率的なのか

### Scanの動作
1. 商品テーブル全体（900件）を読み取る
2. 読み取り後にFilterExpressionで `category = 'electronics'` 以外を除外
3. **RCUは全900件分消費される**（フィルターは読み取り後に適用）

### Queryの動作
1. GSI `category-index` を使用して `category = 'electronics'` のパーティションに直接アクセス
2. 該当する商品（270件）のみを読み取る
3. **RCUは270件分のみ消費**

```
┌─────────────────────────────────────────────────────────────┐
│  Scan: テーブル全体を走査してからフィルター                    │
│  ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐                 │
│  │ E │ C │ B │ F │ E │ C │ B │ E │ F │...│  → 900件読み取り │
│  └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘                 │
│                    ↓ FilterExpression                       │
│              270件返却（でもRCUは900件分）                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Query: GSIで該当パーティションに直接アクセス                  │
│  ┌───────────────────┐                                      │
│  │ electronics (270) │ ← 直接アクセス                        │
│  └───────────────────┘                                      │
│              270件返却（RCUも270件分）                        │
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
└── README.md
```

## 注意事項

- このプロジェクトは検証用途のため、テーブルの`RemovalPolicy`は`DESTROY`に設定されています
- デプロイ先のAWSアカウントに課金が発生する可能性があります
- 使用後は必ず`pnpm run destroy`でリソースを削除してください
