#!/usr/bin/env bash
set -e
DATA_SIZES=(100 1000 10000 100000)

run() {
    local tableName="Products-$1"
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

for size in "${DATA_SIZES[@]}"; do
    echo "=== Products-${size} のデータ検証開始 ==="
    run "$size"
    echo ""
done