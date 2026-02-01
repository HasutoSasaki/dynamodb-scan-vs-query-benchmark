import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as path from "path";

const DATA_SIZES = [100, 1000, 10000, 100000, 1000000];

export class BenchmarkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ========================
    // DynamoDB テーブル（各データサイズ用）
    // ========================
    const tables = DATA_SIZES.map((size) => {
      const table = new dynamodb.Table(this, `ProductsTable${size}`, {
        tableName: `Products-${size}`,
        partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      table.addGlobalSecondaryIndex({
        indexName: "category-name-index",
        partitionKey: { name: "category", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "name", type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      });

      return table;
    });

    // ========================
    // Lambda 関数（共通）
    // ========================
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      bundling: {
        minify: true,
        sourceMap: false,
      },
      tracing: lambda.Tracing.ACTIVE,
    };

    const generateProductsFunction = new NodejsFunction(
      this,
      "GenerateProductsFunction",
      {
        ...commonLambdaProps,
        functionName: "BenchmarkStack-GenerateProductsFunction",
        entry: path.join(__dirname, "../functions/generate-products.ts"),
        handler: "handler",
        timeout: cdk.Duration.minutes(15),
      },
    );

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
      table.grantWriteData(generateProductsFunction);
      table.grantReadData(testScanFunction);
      table.grantReadData(testQueryFunction);
    }

    // テーブル名一覧を出力
    new cdk.CfnOutput(this, "TableNames", {
      value: DATA_SIZES.map((size) => `Products-${size}`).join(", "),
    });
  }
}
