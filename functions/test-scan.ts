import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Handler } from 'aws-lambda';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const TARGET_CATEGORY = 'electronics';

export const handler: Handler = async () => {
  console.log(`Starting Scan benchmark on table: ${TABLE_NAME}`);
  console.log(`Target category: ${TARGET_CATEGORY}`);

  const startTime = Date.now();
  let totalConsumedRCU = 0;
  let scannedCount = 0;
  let returnedCount = 0;
  let pageCount = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  // Scan with FilterExpression (paging through all results)
  do {
    const response = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'category = :category',
        ExpressionAttributeValues: {
          ':category': TARGET_CATEGORY,
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

    console.log(`Page ${pageCount}: Scanned=${response.ScannedCount}, Returned=${response.Count}, RCU=${response.ConsumedCapacity?.CapacityUnits}`);
  } while (lastEvaluatedKey);

  const responseTimeMs = Date.now() - startTime;

  const result = {
    operation: 'scan',
    targetCategory: TARGET_CATEGORY,
    responseTimeMs,
    consumedRCU: totalConsumedRCU,
    scannedCount,
    returnedCount,
    pageCount,
  };

  console.log('Scan result:', JSON.stringify(result, null, 2));
  return result;
};
