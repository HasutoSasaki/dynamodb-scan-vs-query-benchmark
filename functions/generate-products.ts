import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { Handler } from 'aws-lambda';
import { randomUUID } from 'crypto';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const TOTAL_ITEMS = 900;
const BATCH_SIZE = 25; // DynamoDB BatchWriteItem limit

// Category distribution: electronics 30%, clothing 25%, books 25%, food 20%
const CATEGORIES = [
  { name: 'electronics', count: 270 },
  { name: 'clothing', count: 225 },
  { name: 'books', count: 225 },
  { name: 'food', count: 180 },
];

// Sample product names by category
const PRODUCT_NAMES: Record<string, string[]> = {
  electronics: ['Wireless Headphones', 'Smartphone', 'Laptop', 'Tablet', 'Smart Watch', 'Bluetooth Speaker', 'Camera', 'Monitor'],
  clothing: ['T-Shirt', 'Jeans', 'Jacket', 'Sneakers', 'Dress', 'Hoodie', 'Shorts', 'Sweater'],
  books: ['Mystery Novel', 'Science Fiction', 'Biography', 'Cookbook', 'Self-Help Guide', 'History Book', 'Programming Guide', 'Art Book'],
  food: ['Organic Coffee', 'Green Tea', 'Chocolate', 'Pasta', 'Olive Oil', 'Snack Mix', 'Energy Bar', 'Dried Fruit'],
};

// Generate description (approximately 1KB)
function generateDescription(productName: string): string {
  const base = `${productName} - High quality product with excellent features. `;
  return base + 'x'.repeat(1024 - base.length);
}

// Generate a single product item
function generateProduct(category: string, index: number): Record<string, unknown> {
  const names = PRODUCT_NAMES[category];
  const baseName = names[index % names.length];
  const productName = `${baseName} #${index + 1}`;

  return {
    id: randomUUID(),
    category,
    createdAt: new Date(Date.now() - index * 1000).toISOString(),
    name: productName,
    price: Math.floor(Math.random() * 10000) + 100, // 100 - 10099
    description: generateDescription(productName),
  };
}

export const handler: Handler = async () => {
  console.log(`Generating ${TOTAL_ITEMS} products to table: ${TABLE_NAME}`);

  const startTime = Date.now();
  let itemsWritten = 0;

  // Generate all products by category
  const allProducts: Record<string, unknown>[] = [];
  for (const { name: category, count } of CATEGORIES) {
    for (let i = 0; i < count; i++) {
      allProducts.push(generateProduct(category, i));
    }
  }

  // Shuffle products for more realistic distribution
  for (let i = allProducts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allProducts[i], allProducts[j]] = [allProducts[j], allProducts[i]];
  }

  // Process in batches of 25
  for (let i = 0; i < allProducts.length; i += BATCH_SIZE) {
    const batchItems = allProducts.slice(i, i + BATCH_SIZE).map((item) => ({
      PutRequest: { Item: item },
    }));

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batchItems,
        },
      })
    );

    itemsWritten += batchItems.length;
    console.log(`Written ${itemsWritten}/${TOTAL_ITEMS} products`);
  }

  const durationMs = Date.now() - startTime;

  const result = {
    success: true,
    totalProducts: TOTAL_ITEMS,
    categoryBreakdown: Object.fromEntries(CATEGORIES.map((c) => [c.name, c.count])),
    durationMs,
    tableName: TABLE_NAME,
  };

  console.log('Generate result:', JSON.stringify(result, null, 2));
  return result;
};
