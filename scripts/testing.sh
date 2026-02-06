#!/usr/bin/env bash
set -e

ITEM_COUNTS=(100 1000 10000 100000 1000000)
RECORD_SIZES=(0.5 1 5)

run() {
    local tableName="$1"
    # 計測開始（5回ずつ実行）
    echo "=== Scan計測開始 ==="
    # ウォームアップ
    aws lambda invoke --function-name BenchmarkStack-TestScanFunction --cli-binary-format raw-in-base64-out --payload "{\"tableName\":\"$tableName\"}" /dev/null
    sleep 1
    # 検証開始
    for i in {1..5}; do
        echo "--- Scan Run #$i ---"
        aws lambda invoke --function-name BenchmarkStack-TestScanFunction --cli-binary-format raw-in-base64-out --payload "{\"tableName\":\"$tableName\"}" /dev/null
        sleep 1
    done

    echo "=== Query計測開始 ==="
    # ウォームアップ
    aws lambda invoke --function-name BenchmarkStack-TestQueryFunction --cli-binary-format raw-in-base64-out --payload "{\"tableName\":\"$tableName\"}" /dev/null
    sleep 1
    # 検証開始
    for i in {1..5}; do
        echo "--- Query Run #$i ---"
        aws lambda invoke --function-name BenchmarkStack-TestQueryFunction --cli-binary-format raw-in-base64-out --payload "{\"tableName\":\"$tableName\"}" /dev/null
        sleep 1
    done
}

for item_count in "${ITEM_COUNTS[@]}"; do
    for record_size in "${RECORD_SIZES[@]}"; do
        table_name="Products-${item_count}-${record_size}kb"
        echo "=== ${table_name} のデータ検証開始 ==="
        run "$table_name"
        echo ""
    done
done