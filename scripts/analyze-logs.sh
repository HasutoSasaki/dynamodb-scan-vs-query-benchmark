#!/usr/bin/env bash

ITEM_COUNTS=(100 1000 10000 100000 1000000)
RECORD_SIZES=(0.5 1 5)
SINCE="${1:-2h}"

echo "========================================"
echo "  DynamoDB Scan vs Query ベンチマーク結果"
echo "========================================"
echo "（過去 ${SINCE} のログを分析）"
echo ""

# 結果を整形する関数（テーブル名でフィルタリング）
parse_results() {
  local table_name="$1"
  awk -v table="$table_name" '
    /"tableName"/ { gsub(/[",]/, "", $2); current_table = $2 }
    /"responseTimeMs"/ { gsub(/[^0-9]/, "", $2); time=$2 }
    /"consumedRCU"/ { gsub(/[^0-9.]/, "", $2); rcu=$2 }
    /"scannedCount"/ { gsub(/[^0-9]/, "", $2); scanned=$2 }
    /"returnedCount"/ { gsub(/[^0-9]/, "", $2); returned=$2 }
    /"pageCount"/ { gsub(/[^0-9]/, "", $2); pages=$2
      if (current_table == table) {
        printf "  時間: %6dms | RCU: %8s | ページ: %3d回 | スキャン: %7d件 | 結果: %6d件\n", time, rcu, pages, scanned, returned
      }
    }
  '
}

# ログを一度だけ取得してキャッシュ
scan_logs=$(aws logs tail /aws/lambda/BenchmarkStack-TestScanFunction --since "$SINCE" 2>/dev/null)
query_logs=$(aws logs tail /aws/lambda/BenchmarkStack-TestQueryFunction --since "$SINCE" 2>/dev/null)

for item_count in "${ITEM_COUNTS[@]}"; do
  for record_size in "${RECORD_SIZES[@]}"; do
    table_name="Products-${item_count}-${record_size}kb"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📊 データ件数: ${item_count} 件 / レコードサイズ: ${record_size}KB（テーブル: ${table_name}）"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "【Scan + FilterExpression】"
    echo "$scan_logs" | parse_results "$table_name"
    echo ""
    echo "【Query (GSI)】"
    echo "$query_logs" | parse_results "$table_name"
    echo ""
  done
done

echo "========================================="
