import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { Handler } from "aws-lambda";
import { randomUUID } from "crypto";

interface Product {
  id: string; // UUID 36文字
  category: string; // 電子機器、衣類、書籍、食品
  createdAt: number; // Unixタイムスタンプ（ミリ秒）
  name: string; // 商品名
  price: number; // 価格（円）
  description: string; // 商品説明 (約1KBになるよう調整)
}

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const BATCH_SIZE = 25;
const PARALLEL_BATCHES = 10;
const CHUNK_SIZE = 1000; // メモリ節約のため1000件ずつ処理

// カテゴリ分布: 電子機器 30%, 衣類 25%, 書籍 25%, 食品 20%
const CATEGORY_RATIOS = [
  { name: "電子機器", ratio: 0.3 },
  { name: "衣類", ratio: 0.25 },
  { name: "書籍", ratio: 0.25 },
  { name: "食品", ratio: 0.2 },
];

interface GenerateEvent {
  tableName: string;
  totalItems: number;
}

// カテゴリ別の商品名サンプル
const PRODUCT_NAMES: Record<string, string[]> = {
  電子機器: [
    "ワイヤレスヘッドホン",
    "スマートフォン",
    "ノートパソコン",
    "タブレット",
    "スマートウォッチ",
    "Bluetoothスピーカー",
    "デジタルカメラ",
    "液晶モニター",
  ],
  衣類: [
    "Tシャツ",
    "デニムジーンズ",
    "レザージャケット",
    "スニーカー",
    "ワンピース",
    "パーカー",
    "ショートパンツ",
    "ニットセーター",
  ],
  書籍: [
    "ミステリー小説",
    "SF小説",
    "伝記",
    "料理本",
    "自己啓発書",
    "歴史書",
    "プログラミング入門",
    "美術書",
  ],
  食品: [
    "オーガニックコーヒー",
    "緑茶",
    "チョコレート",
    "パスタ",
    "オリーブオイル",
    "ミックスナッツ",
    "エナジーバー",
    "ドライフルーツ",
  ],
};

// 1レコードあたり約1KBになるよう説明文を生成
// UUID(36) + category(~20) + createdAt(24) + name(~50) + price(4) + description(残り) ≒ 1024
const TARGET_RECORD_SIZE = 1024;
const OTHER_FIELDS_SIZE = 150; // 他フィールドの概算サイズ

function generateDescription(productName: string): string {
  const base = `${productName}は、厳選された素材と熟練の技術で作られた高品質な商品です。お客様の満足を第一に考え、細部までこだわり抜いた逸品をお届けします。`;
  const targetDescSize = TARGET_RECORD_SIZE - OTHER_FIELDS_SIZE;
  const padding = "あ".repeat(
    Math.max(0, Math.floor((targetDescSize - base.length * 3) / 3)),
  );
  return base + padding;
}

// 商品データを1件生成
function generateProduct(category: string, index: number): Product {
  const names = PRODUCT_NAMES[category];
  const baseName = names[index % names.length];
  const productName = `${baseName} #${index + 1}`;

  return {
    id: randomUUID(),
    category,
    createdAt: Date.now() - index * 1000,
    name: productName,
    price: Math.floor(Math.random() * 10000) + 100, // 100 - 10099
    description: generateDescription(productName),
  };
}

async function writeBatch(tableName: string, items: Product[]): Promise<number> {
  const batchPromises = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE * PARALLEL_BATCHES) {
    for (let j = 0; j < PARALLEL_BATCHES; j++) {
      const start = i + j * BATCH_SIZE;
      if (start >= items.length) break;
      const batchItems = items.slice(start, start + BATCH_SIZE).map((item) => ({
        PutRequest: { Item: item },
      }));
      batchPromises.push(
        docClient.send(
          new BatchWriteCommand({
            RequestItems: { [tableName]: batchItems },
          }),
        ).then(() => batchItems.length),
      );
    }
  }
  const results = await Promise.all(batchPromises);
  return results.reduce((a, b) => a + b, 0);
}

export const handler: Handler<GenerateEvent> = async (event) => {
  const { tableName, totalItems } = event;
  console.log(`${totalItems}件の商品を生成します（テーブル: ${tableName}）`);

  const startTime = Date.now();

  // カテゴリ別件数を計算
  const categories = CATEGORY_RATIOS.map(({ name, ratio }) => ({
    name,
    count: Math.floor(totalItems * ratio),
  }));

  let itemsWritten = 0;

  // カテゴリごとにチャンク単位で生成・書き込み
  for (const { name: category, count } of categories) {
    for (let offset = 0; offset < count; offset += CHUNK_SIZE) {
      const chunkSize = Math.min(CHUNK_SIZE, count - offset);
      const chunk: Product[] = [];
      for (let i = 0; i < chunkSize; i++) {
        chunk.push(generateProduct(category, offset + i));
      }
      itemsWritten += await writeBatch(tableName, chunk);
      console.log(`書き込み完了: ${itemsWritten}/${totalItems} 件`);
    }
  }

  const durationMs = Date.now() - startTime;

  const result = {
    success: true,
    totalProducts: totalItems,
    categoryBreakdown: Object.fromEntries(categories.map((c) => [c.name, c.count])),
    durationMs,
    tableName,
  };

  console.log("生成結果:", JSON.stringify(result, null, 2));
  return result;
};
