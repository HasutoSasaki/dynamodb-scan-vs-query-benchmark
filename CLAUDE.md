# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a benchmark project comparing DynamoDB Scan (with FilterExpression) vs Query (with GSI) for an e-commerce product catalog use case. It uses AWS CDK with TypeScript to deploy Lambda functions and a DynamoDB table.

## Commands

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm run build

# Deploy to AWS (requires configured AWS CLI and CDK bootstrap)
pnpm run deploy

# Run benchmarks (after deploy and data generation)
pnpm run generate-products   # Generate 900 test products
pnpm run test-scan           # Run Scan + FilterExpression benchmark
pnpm run test-query          # Run Query with GSI benchmark

# Clean up AWS resources
pnpm run destroy
```

## Architecture

- **CDK Stack** (`lib/benchmark-stack.ts`): Defines DynamoDB table with GSI and three Lambda functions
- **Lambda Functions** (`functions/`):
  - `generate-products.ts`: Creates 900 products with category distribution
  - `test-scan.ts`: Benchmarks full table scan with filter
  - `test-query.ts`: Benchmarks GSI query for category lookup

The DynamoDB table uses `id` as partition key with a GSI on `category` (partition key) and `createdAt` (sort key).
