import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export class BenchmarkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'ProductsTable', {
      tableName: 'Products',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'category-index',
      partitionKey: { name: 'category', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Common Lambda configuration
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
        INDEX_NAME: 'category-index',
      },
      bundling: {
        minify: true,
        sourceMap: false,
      },
    };

    // Generate Products Lambda
    const generateProductsFunction = new NodejsFunction(this, 'GenerateProductsFunction', {
      ...commonLambdaProps,
      functionName: 'BenchmarkStack-GenerateProductsFunction',
      entry: path.join(__dirname, '../functions/generate-products.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
    });

    // Test Scan Lambda
    const testScanFunction = new NodejsFunction(this, 'TestScanFunction', {
      ...commonLambdaProps,
      functionName: 'BenchmarkStack-TestScanFunction',
      entry: path.join(__dirname, '../functions/test-scan.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
    });

    // Test Query Lambda
    const testQueryFunction = new NodejsFunction(this, 'TestQueryFunction', {
      ...commonLambdaProps,
      functionName: 'BenchmarkStack-TestQueryFunction',
      entry: path.join(__dirname, '../functions/test-query.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
    });

    // Grant permissions
    table.grantWriteData(generateProductsFunction);
    table.grantReadData(testScanFunction);
    table.grantReadData(testQueryFunction);

    // Outputs
    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'DynamoDB Table Name',
    });

    new cdk.CfnOutput(this, 'GenerateProductsFunctionName', {
      value: generateProductsFunction.functionName,
      description: 'Generate Products Lambda Function Name',
    });

    new cdk.CfnOutput(this, 'ScanFunctionName', {
      value: testScanFunction.functionName,
      description: 'Test Scan Lambda Function Name',
    });

    new cdk.CfnOutput(this, 'QueryFunctionName', {
      value: testQueryFunction.functionName,
      description: 'Test Query Lambda Function Name',
    });
  }
}
