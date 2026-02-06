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

# Generate test data (run locally, after deploy)
pnpm run generate-local      # Generate test products to DynamoDB tables

# Run benchmarks
pnpm run test-scan           # Run Scan + FilterExpression benchmark
pnpm run test-query          # Run Query with GSI benchmark

# Clean up AWS resources
pnpm run destroy
```

## Architecture

- **CDK Stack** (`lib/benchmark-stack.ts`): Defines DynamoDB tables with GSI and two Lambda functions
- **Lambda Functions** (`functions/`):
  - `test-scan.ts`: Benchmarks full table scan with filter
  - `test-query.ts`: Benchmarks GSI query for category lookup
- **Local Scripts** (`scripts/`):
  - `generate-products-local.ts`: Generates test products from local machine

The DynamoDB table uses `id` as partition key with a GSI on `category` (partition key) and `createdAt` (sort key).
