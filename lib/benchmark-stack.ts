import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as path from "path";

const ITEM_COUNTS = [100, 1000, 10000, 100000, 1000000];
const RECORD_SIZES = [0.5, 1, 5]; // KB

export class BenchmarkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ========================
    // DynamoDB テーブル（アイテム数 × レコードサイズの組み合わせ）
    // ========================
    const tables = ITEM_COUNTS.flatMap((itemCount) =>
      RECORD_SIZES.map((recordSize) => {
        const recordSizeLabel = recordSize === 0.5 ? "0_5" : String(recordSize);
        const tableId = `ProductsTable${itemCount}_${recordSizeLabel}kb`;
        const tableName = `Products-${itemCount}-${recordSize}kb`;

        const table = new dynamodb.Table(this, tableId, {
          tableName,
          partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
          billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        table.addGlobalSecondaryIndex({
          indexName: "category-name-index",
          partitionKey: {
            name: "category",
            type: dynamodb.AttributeType.STRING,
          },
          sortKey: { name: "name", type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.ALL,
        });

        return table;
      }),
    );

    // ========================
    // Lambda 関数（共通）
    // ========================
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 1024,
      bundling: {
        minify: true,
        sourceMap: false,
      },
      tracing: lambda.Tracing.ACTIVE,
    };

    const testScanFunction = new NodejsFunction(this, "TestScanFunction", {
      ...commonLambdaProps,
      functionName: "BenchmarkStack-TestScanFunction",
      entry: path.join(__dirname, "../functions/test-scan.ts"),
      handler: "handler",
      timeout: cdk.Duration.minutes(15),
    });

    const testQueryFunction = new NodejsFunction(this, "TestQueryFunction", {
      ...commonLambdaProps,
      functionName: "BenchmarkStack-TestQueryFunction",
      entry: path.join(__dirname, "../functions/test-query.ts"),
      handler: "handler",
      timeout: cdk.Duration.minutes(15),
    });

    // 全テーブルへの権限付与
    for (const table of tables) {
      table.grantReadData(testScanFunction);
      table.grantReadData(testQueryFunction);
    }

    // テーブル名一覧を出力
    new cdk.CfnOutput(this, "TableNames", {
      value: ITEM_COUNTS.flatMap((itemCount) =>
        RECORD_SIZES.map(
          (recordSize) => `Products-${itemCount}-${recordSize}kb`,
        ),
      ).join(", "),
    });
  }
}
