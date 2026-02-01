import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Handler } from 'aws-lambda';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

interface ScanEvent {
  tableName: string;
  category?: string;
}

export const handler: Handler<ScanEvent> = async (event) => {
  const tableName = event.tableName;
  const targetCategory = event.category ?? '電子機器';
  console.log(`Scanベンチマーク開始（テーブル: ${tableName}）`);
  console.log(`対象カテゴリ: ${targetCategory}`);

  const startTime = Date.now();
  let totalConsumedRCU = 0;
  let scannedCount = 0;
  let returnedCount = 0;
  let pageCount = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  // FilterExpressionを使用したScan（ページネーションで全結果を取得）
  do {
    const response = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'category = :category',
        ExpressionAttributeValues: {
          ':category': targetCategory,
        },
        ReturnConsumedCapacity: 'TOTAL',
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    pageCount++;
    scannedCount += response.ScannedCount || 0;
    returnedCount += response.Count || 0;
    totalConsumedRCU += response.ConsumedCapacity?.CapacityUnits || 0;
    lastEvaluatedKey = response.LastEvaluatedKey;

    console.log(`ページ${pageCount}: スキャン件数=${response.ScannedCount}, 返却件数=${response.Count}, 消費RCU=${response.ConsumedCapacity?.CapacityUnits}`);
  } while (lastEvaluatedKey);

  const responseTimeMs = Date.now() - startTime;

  const result = {
    operation: 'scan',
    tableName,
    targetCategory,
    responseTimeMs,
    consumedRCU: totalConsumedRCU,
    scannedCount,
    returnedCount,
    pageCount,
  };

  console.log('Scan結果:', JSON.stringify(result, null, 2));
  return result;
};
