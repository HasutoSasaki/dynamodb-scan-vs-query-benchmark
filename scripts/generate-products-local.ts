import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

interface Product {
  id: string;
  category: string;
  createdAt: number;
  name: string;
  price: number;
  description: string;
}

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-northeast-1",
});
const docClient = DynamoDBDocumentClient.from(client);

const BATCH_SIZE = 25;
const PARALLEL_BATCHES = 5; // スロットリング対策で並列数を減らす
const CHUNK_SIZE = 1000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

const CATEGORY_RATIOS = [
  { name: "電子機器", ratio: 0.3 },
  { name: "衣類", ratio: 0.25 },
  { name: "書籍", ratio: 0.25 },
  { name: "食品", ratio: 0.2 },
];

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

const OTHER_FIELDS_SIZE = 150;

function generateDescription(
  productName: string,
  targetRecordSize: number,
): string {
  const base = `${productName}は、厳選された素材と熟練の技術で作られた高品質な商品です。お客様の満足を第一に考え、細部までこだわり抜いた逸品をお届けします。`;
  const targetDescSize = targetRecordSize - OTHER_FIELDS_SIZE;
  const padding = "あ".repeat(
    Math.max(0, Math.floor((targetDescSize - base.length * 3) / 3)),
  );
  return base + padding;
}

function generateProduct(
  category: string,
  index: number,
  targetRecordSize: number,
): Product {
  const names = PRODUCT_NAMES[category];
  const baseName = names[index % names.length];
  const productName = `${baseName} #${index + 1}`;

  return {
    id: randomUUID(),
    category,
    createdAt: Date.now() - index * 1000,
    name: productName,
    price: Math.floor(Math.random() * 10000) + 100,
    description: generateDescription(productName, targetRecordSize),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeBatchWithRetry(
  tableName: string,
  batchItems: Record<string, unknown>[],
): Promise<number> {
  let unprocessed: Record<string, unknown>[] | undefined = batchItems;
  let written = 0;

  for (let attempt = 0; attempt < MAX_RETRIES && unprocessed && unprocessed.length > 0; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      process.stdout.write(`\n  再試行 ${attempt}/${MAX_RETRIES}: ${unprocessed.length}件, ${delay}ms 待機...`);
      await sleep(delay);
    }

    try {
      const response = await docClient.send(
        new BatchWriteCommand({
          RequestItems: { [tableName]: unprocessed },
        }),
      );

      const unprocessedItems = response.UnprocessedItems?.[tableName];
      const processedCount = unprocessed.length - (unprocessedItems?.length ?? 0);
      written += processedCount;

      if (unprocessedItems && unprocessedItems.length > 0) {
        unprocessed = unprocessedItems as Record<string, unknown>[];
      } else {
        unprocessed = undefined;
      }
    } catch (err: unknown) {
      const isThrottling =
        err instanceof Error &&
        (err.name === "ThrottlingException" ||
          err.name === "ProvisionedThroughputExceededException");
      if (isThrottling && attempt < MAX_RETRIES - 1) {
        // 次のループで再試行
        continue;
      }
      throw err;
    }
  }

  if (unprocessed && unprocessed.length > 0) {
    console.error(`\n  警告: ${unprocessed.length}件の書き込みに失敗`);
  }

  return written;
}

async function writeBatch(
  tableName: string,
  items: Product[],
): Promise<number> {
  let totalWritten = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE * PARALLEL_BATCHES) {
    const batchPromises = [];
    for (let j = 0; j < PARALLEL_BATCHES; j++) {
      const start = i + j * BATCH_SIZE;
      if (start >= items.length) break;
      const batchItems = items.slice(start, start + BATCH_SIZE).map((item) => ({
        PutRequest: { Item: item },
      }));
      batchPromises.push(writeBatchWithRetry(tableName, batchItems));
    }
    const results = await Promise.all(batchPromises);
    totalWritten += results.reduce((a, b) => a + b, 0);

    // チャンク間で少し待機してスロットリングを防ぐ
    await sleep(50);
  }

  return totalWritten;
}

async function generateData(
  tableName: string,
  totalItems: number,
  recordSizeKb: number,
  startFromItem: number = 0,
): Promise<void> {
  const targetRecordSize = recordSizeKb * 1024;
  console.log(
    `\n${totalItems}件の商品を生成します（テーブル: ${tableName}, レコードサイズ: ${recordSizeKb}KB, 開始位置: ${startFromItem}）`,
  );

  const startTime = Date.now();

  const categories = CATEGORY_RATIOS.map(({ name, ratio }) => ({
    name,
    count: Math.floor(totalItems * ratio),
  }));

  let itemsWritten = 0;
  let totalProcessed = 0;

  for (const { name: category, count } of categories) {
    const categoryStart = totalProcessed;
    const categoryEnd = totalProcessed + count;

    // このカテゴリがすでに完了済みならスキップ
    if (startFromItem >= categoryEnd) {
      totalProcessed = categoryEnd;
      continue;
    }

    // このカテゴリ内での開始オフセットを計算
    const skipInCategory = Math.max(0, startFromItem - categoryStart);

    for (let offset = skipInCategory; offset < count; offset += CHUNK_SIZE) {
      const chunkSize = Math.min(CHUNK_SIZE, count - offset);
      const chunk: Product[] = [];
      for (let i = 0; i < chunkSize; i++) {
        chunk.push(generateProduct(category, offset + i, targetRecordSize));
      }
      itemsWritten += await writeBatch(tableName, chunk);
      process.stdout.write(`\r  書き込み完了: ${startFromItem + itemsWritten}/${totalItems} 件`);
    }

    totalProcessed = categoryEnd;
  }

  const durationMs = Date.now() - startTime;
  console.log(`\n  完了: ${durationMs}ms (${itemsWritten}件追加)`);
}

async function main(): Promise<void> {
  const ITEM_COUNTS = [100, 1000, 10000, 100000, 1000000];
  const RECORD_SIZES = [0.5, 1, 5];

  // コマンドライン引数でフィルタリング可能
  const args = process.argv.slice(2);
  const filterItemCount = args[0] ? parseInt(args[0], 10) : null;
  const filterRecordSize = args[1] ? parseFloat(args[1]) : null;
  const startFromItem = args[2] ? parseInt(args[2], 10) : 0;

  const targets: { itemCount: number; recordSize: number }[] = [];

  for (const itemCount of ITEM_COUNTS) {
    for (const recordSize of RECORD_SIZES) {
      if (filterItemCount && itemCount !== filterItemCount) continue;
      if (filterRecordSize && recordSize !== filterRecordSize) continue;
      targets.push({ itemCount, recordSize });
    }
  }

  if (targets.length === 0) {
    console.log("対象テーブルがありません");
    console.log("使用方法: npx tsx scripts/generate-products-local.ts [itemCount] [recordSizeKb] [startFromItem]");
    console.log("例: npx tsx scripts/generate-products-local.ts 100 0.5");
    console.log("    npx tsx scripts/generate-products-local.ts 100      # 100件の全レコードサイズ");
    console.log("    npx tsx scripts/generate-products-local.ts          # 全テーブル");
    console.log("    npx tsx scripts/generate-products-local.ts 1000000 1 935000  # 途中から再開");
    process.exit(1);
  }

  console.log(`=== ${targets.length} テーブルのデータ生成を開始 ===`);
  if (startFromItem > 0) {
    console.log(`=== ${startFromItem}件目から再開 ===`);
  }

  for (const { itemCount, recordSize } of targets) {
    const tableName = `Products-${itemCount}-${recordSize}kb`;
    await generateData(tableName, itemCount, recordSize, startFromItem);
  }

  console.log("\n=== 全データ生成完了 ===");
}

main().catch((err) => {
  console.error("エラー:", err);
  process.exit(1);
});
