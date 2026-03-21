#!/usr/bin/env bash
# =============================================================================
# integration_test.sh — end-to-end tests for the blocktree cache and SQL
# queue batching performance fixes.
#
# Scenarios tested:
#   1. Batch queue     – 30 rapid doc creates must all persist (no dropped ops)
#   2. Path eviction   – delete a parent doc; its child blocks are inaccessible
#   3. Box eviction    – close then reopen a notebook; blocks still accessible
#   4. Index rebuild   – rebuildDataIndex clears and rebuilds; blocks survive
#   5. Crash recovery  – kill -9 then restart; last write survives (WAL)
#
# Usage:
#   bash scripts/integration_test.sh
#   bash scripts/integration_test.sh --keep-workspace   # preserve workspace
# =============================================================================
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KERNEL_DIR="$REPO_DIR/kernel"
APP_DIR="$REPO_DIR/app"
PORT=16898
BASE="http://localhost:$PORT"
KERNEL_BIN="$KERNEL_DIR/siyuan-kernel-itest"
WORKSPACE="$(mktemp -d /tmp/siyuan-itest-XXXXXX)"
KEEP_WORKSPACE=0
[[ "${1:-}" == "--keep-workspace" ]] && KEEP_WORKSPACE=1

PASS=0; FAIL=0
KERNEL_PID=""

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; NC='\033[0m'

pass()   { echo -e "${GREEN}✓${NC} $1"; ((PASS++)); }
fail()   { echo -e "${RED}✗${NC} $1"; ((FAIL++)); }
info()   { echo -e "${YELLOW}→${NC} $1"; }
header() { echo -e "\n${BOLD}── $1 ──${NC}"; }
skip()   { echo -e "  (skipped: $1)"; }

# ─── cleanup ──────────────────────────────────────────────────────────────────
cleanup() {
    if [[ -n "$KERNEL_PID" ]] && kill -0 "$KERNEL_PID" 2>/dev/null; then
        kill "$KERNEL_PID" 2>/dev/null
        wait "$KERNEL_PID" 2>/dev/null || true
    fi
    if [[ $KEEP_WORKSPACE -eq 0 ]]; then
        rm -rf "$WORKSPACE"
    else
        info "Workspace preserved at: $WORKSPACE"
        info "Kernel log: $WORKSPACE/kernel.log"
    fi
}
trap cleanup EXIT

# ─── API helpers ──────────────────────────────────────────────────────────────
api() {
    local path=$1 body=${2:-\{\}}
    curl -s --max-time 10 -X POST "$BASE$path" \
         -H "Content-Type: application/json" \
         -d "$body"
}

# Extract a JSON field via Python (always available on Linux).
# Usage: jval 'd["data"]["notebook"]["id"]' "$json_string"
jval() {
    python3 -c "
import sys, json
try:
    d = json.loads(sys.argv[2])
    v = eval(sys.argv[1])
    print(v if v is not None else '')
except Exception as e:
    print('', file=sys.stderr)
    sys.exit(1)
" "$1" "$2" 2>/dev/null
}

# Return the 'code' field from a JSON response (0 = success).
jcode() { jval 'd["code"]' "$1"; }

wait_ready() {
    local retries=60
    while ((retries-- > 0)); do
        if curl -s --max-time 2 "$BASE/api/system/currentTime" >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.5
    done
    echo "ERROR: kernel did not become ready within 30 s" >&2
    return 1
}

start_kernel() {
    "$KERNEL_BIN" \
        --wd="$APP_DIR" \
        --workspace="$WORKSPACE" \
        --port="$PORT" \
        --mode=dev \
        >>"$WORKSPACE/kernel.log" 2>&1 &
    KERNEL_PID=$!
    if ! wait_ready; then
        fail "Kernel failed to start (see $WORKSPACE/kernel.log)"
        exit 1
    fi
    info "Kernel running  PID=$KERNEL_PID"
}

stop_kernel() {
    if [[ -n "$KERNEL_PID" ]] && kill -0 "$KERNEL_PID" 2>/dev/null; then
        kill "$KERNEL_PID"
        wait "$KERNEL_PID" 2>/dev/null || true
        KERNEL_PID=""
    fi
}

hard_kill_kernel() {
    if [[ -n "$KERNEL_PID" ]] && kill -0 "$KERNEL_PID" 2>/dev/null; then
        kill -9 "$KERNEL_PID"
        wait "$KERNEL_PID" 2>/dev/null || true
        KERNEL_PID=""
        info "Kernel killed with SIGKILL"
    fi
}

# Create a notebook and return its box ID, or fail.
create_notebook() {
    local name=$1
    local resp
    resp=$(api /api/notebook/createNotebook "{\"name\":\"$name\"}")
    local id
    id=$(jval 'd["data"]["notebook"]["id"]' "$resp")
    if [[ -z "$id" || "$id" == "None" ]]; then
        echo "ERROR: createNotebook($name) failed: $resp" >&2
        return 1
    fi
    echo "$id"
}

# Create a doc with markdown content and return the root block ID.
create_doc() {
    local box=$1 path=$2 markdown=$3 parentID=${4:-}
    local body
    body=$(python3 -c "
import json, sys
d = {'notebook': sys.argv[1], 'path': sys.argv[2], 'markdown': sys.argv[3]}
if sys.argv[4]:
    d['parentID'] = sys.argv[4]
print(json.dumps(d))
" "$box" "$path" "$markdown" "$parentID")
    local resp
    resp=$(api /api/filetree/createDocWithMd "$body")
    local id
    id=$(jval 'd["data"]' "$resp")
    if [[ -z "$id" || "$id" == "None" ]]; then
        echo "ERROR: createDocWithMd($path) failed: $resp" >&2
        return 1
    fi
    echo "$id"
}

# Append a markdown paragraph to a parent block; return the new block ID.
append_block() {
    local parentID=$1 text=$2
    local resp
    resp=$(api /api/block/appendBlock \
        "{\"data\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$text"),\"dataType\":\"markdown\",\"parentID\":\"$parentID\"}")
    local id
    id=$(jval 'd["data"][0]["doOperations"][0]["id"]' "$resp")
    if [[ -z "$id" || "$id" == "None" ]]; then
        echo "ERROR: appendBlock failed: $resp" >&2
        return 1
    fi
    echo "$id"
}

# Return 0 if getBlockInfo for $id succeeds (code==0), 1 otherwise.
block_accessible() {
    local id=$1
    local resp code
    resp=$(api /api/block/getBlockInfo "{\"id\":\"$id\"}")
    code=$(jcode "$resp")
    [[ "$code" == "0" ]]
}

# ─── BUILD ────────────────────────────────────────────────────────────────────
header "Build"
info "Building kernel with -tags fts5,noping …"
mkdir -p "$WORKSPACE"
touch "$WORKSPACE/kernel.log"
if ! (cd "$KERNEL_DIR" && go build -tags fts5,noping -o "$KERNEL_BIN" . 2>&1); then
    echo "Build failed." >&2; exit 1
fi
pass "Kernel binary built: $KERNEL_BIN"

# ─── START ────────────────────────────────────────────────────────────────────
header "Startup"
start_kernel

# ─── SCENARIO 1: Batch queue — 30 rapid doc creates ──────────────────────────
header "Scenario 1: Batch Queue (30 rapid doc creates)"
info "Creating notebook and inserting 30 docs without waiting between them…"

BOX1=$(create_notebook "itest-batch") || { fail "Could not create notebook"; exit 1; }
DOC_IDS=()
for i in $(seq 1 30); do
    id=$(create_doc "$BOX1" "/batch-doc-$i" "# Batch $i\n\nparagraph $i") || continue
    DOC_IDS+=("$id")
done

# Small wait for the queue to flush (normally < 200 ms).
sleep 0.5

MISSING=0
for id in "${DOC_IDS[@]}"; do
    block_accessible "$id" || ((MISSING++))
done

if [[ ${#DOC_IDS[@]} -eq 30 && $MISSING -eq 0 ]]; then
    pass "All 30 docs (root blocks) persisted and accessible"
elif [[ ${#DOC_IDS[@]} -lt 30 ]]; then
    fail "Only ${#DOC_IDS[@]}/30 docs created — API issue, not a cache bug"
else
    fail "$MISSING/30 doc root blocks not accessible after rapid creation (possible data-loss)"
fi

# ─── SCENARIO 2: Path eviction — delete parent, child becomes inaccessible ───
header "Scenario 2: Path-prefix Eviction (delete parent doc)"
BOX2=$(create_notebook "itest-path") || { fail "Could not create notebook"; exit 1; }

# Create a parent doc.
PARENT_DOC=$(create_doc "$BOX2" "/parent" "# Parent") || { fail "create parent doc"; exit 1; }
# Create a paragraph inside the parent doc.
PARENT_BLOCK=$(append_block "$PARENT_DOC" "parent paragraph") || { fail "append to parent"; exit 1; }

# Verify it's accessible now.
if block_accessible "$PARENT_BLOCK"; then
    pass "Parent block accessible before deletion (pre-condition)"
else
    fail "Parent block not accessible before deletion (pre-condition failed)"
fi

# Get the parent doc's internal path via getBlockInfo.
RESP=$(api /api/block/getBlockInfo "{\"id\":\"$PARENT_DOC\"}")
PARENT_PATH=$(jval 'd["data"]["path"]' "$RESP")
info "Parent doc internal path: $PARENT_PATH"

if [[ -z "$PARENT_PATH" || "$PARENT_PATH" == "None" ]]; then
    fail "Could not retrieve parent doc path — skipping deletion sub-test"
    skip "path eviction after-deletion check"
else
    # Delete the parent doc.
    api /api/filetree/removeDoc \
        "{\"notebook\":\"$BOX2\",\"path\":\"$PARENT_PATH\"}" >/dev/null
    sleep 0.5

    # All blocks in the deleted doc must now be inaccessible.
    if ! block_accessible "$PARENT_BLOCK"; then
        pass "Block correctly inaccessible after doc deletion (cache evicted)"
    else
        fail "Block still accessible after doc deletion — stale cache entry"
    fi
fi

# ─── SCENARIO 3: Box eviction — close / reopen notebook ──────────────────────
header "Scenario 3: Box Eviction (close / reopen notebook)"
BOX3=$(create_notebook "itest-box") || { fail "Could not create notebook"; exit 1; }

BOX_DOC=$(create_doc "$BOX3" "/box-doc" "# Box Test") || { fail "create box doc"; exit 1; }
BOX_BLOCK=$(append_block "$BOX_DOC" "box paragraph") || { fail "append to box doc"; exit 1; }

info "Closing notebook $BOX3 …"
api /api/notebook/closeNotebook "{\"notebook\":\"$BOX3\"}" >/dev/null
sleep 0.5

info "Reopening notebook …"
api /api/notebook/openNotebook "{\"notebook\":\"$BOX3\"}" >/dev/null
sleep 1.5  # index rebuild from disk takes a moment

if block_accessible "$BOX_BLOCK"; then
    pass "Block accessible after notebook close/reopen (box eviction + reload)"
else
    fail "Block not accessible after close/reopen — cache reload failure"
fi

# ─── SCENARIO 4: Full index rebuild ───────────────────────────────────────────
header "Scenario 4: Index Rebuild (rebuildDataIndex)"

REBUILD_BLOCK=$(append_block "$BOX_DOC" "paragraph before rebuild") || \
    { fail "append block for rebuild test"; exit 1; }

info "Calling rebuildDataIndex …"
api /api/system/rebuildDataIndex '{}' >/dev/null
info "Waiting for rebuild to complete (3 s) …"
sleep 3

if block_accessible "$REBUILD_BLOCK"; then
    pass "Block accessible after full index rebuild"
else
    fail "Block not accessible after index rebuild — cache rebuild failure"
fi

# ─── SCENARIO 5: Crash recovery — kill -9 then restart ───────────────────────
header "Scenario 5: Crash Recovery (SIGKILL + restart)"

# Wait for any pending queue flushes.
sleep 0.5

CRASH_DOC=$(create_doc "$BOX3" "/crash-test" "# Crash Test") || { fail "create crash doc"; exit 1; }
CRASH_BLOCK=$(append_block "$CRASH_DOC" "sentinel after crash") || { fail "append sentinel block"; exit 1; }

info "Waiting for queue flush before crash …"
sleep 0.5

info "Sending SIGKILL to PID $KERNEL_PID …"
hard_kill_kernel
sleep 0.5

info "Restarting kernel …"
start_kernel

if block_accessible "$CRASH_BLOCK"; then
    pass "Sentinel block survived kill -9 restart (WAL durability confirmed)"
else
    fail "Sentinel block lost after kill -9 — WAL not protecting committed writes"
fi

# ─── TEARDOWN ─────────────────────────────────────────────────────────────────
stop_kernel

echo ""
echo -e "${BOLD}Results: ${GREEN}${PASS} passed${NC}${BOLD}, ${RED}${FAIL} failed${NC}"
echo ""
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
