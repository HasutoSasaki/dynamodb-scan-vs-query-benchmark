#!/usr/bin/env bash
set -e

DATA_SIZES=(1000000)

for size in "${DATA_SIZES[@]}"; do
    echo "=== Products-${size} のデータ生成開始 ==="
    aws lambda invoke \
        --function-name BenchmarkStack-GenerateProductsFunction \
        --cli-binary-format raw-in-base64-out \
        --payload "{\"tableName\":\"Products-${size}\",\"totalItems\":${size}}" \
        --cli-read-timeout 900 \
        /tmp/generate-${size}.json
    echo "結果:"
    cat /tmp/generate-${size}.json
    echo ""
done

echo "=== 全データ生成完了 ==="
