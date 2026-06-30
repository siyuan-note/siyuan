// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"container/heap"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/88250/gulu"
	ignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	embeddingBatchSize      = 10
	embeddingMaxConcurrency = 8
	embeddingMinTextLen     = 7
	embeddingMaxContentLen  = 12000
	embeddingVectorDim      = 4 // float32 = 4 bytes

	// 嵌入失败重试的退避参数：API 不可用时避免连接风暴
	// delay = min(embeddingBackoffBase << (failCount-1), embeddingBackoffMax)
	embeddingBackoffBase  = 30      // 首次失败后 30s 重试
	embeddingBackoffMax   = 30 * 60 // 上限 30min
	embeddingMaxFailCount = 8       // 单块连续失败到此次数视为永久失败，不再调度
)

var (
	embeddingDirtyCh = make(chan string, 1024)
	embeddingTableOk bool

	embeddingIgnoreLoaded  bool
	embeddingIgnoreMatcher *ignore.GitIgnore
	embeddingIgnoreLock    sync.Mutex

	embeddingStop atomic.Bool

	// embeddingErrNotified 标记本轮是否已向用户提示过嵌入失败，避免多个并发 worker 失败时重复弹窗。
	// 每次 processPendingEmbeddings 开始时随 embeddingStop 一起重置。
	embeddingErrNotified atomic.Bool
)

func checkEmbeddingTable() bool {
	_, err := sql.QueryNoLimit("SELECT COUNT(*) FROM block_embeddings")
	if err != nil {
		logging.LogWarnf("block_embeddings table not available, embedding indexer disabled: %s", err)
		return false
	}
	return true
}

func StartEmbeddingIndexer() {
	if !checkEmbeddingTable() || !isEmbeddingEnabled() {
		return
	}

	eventbus.Subscribe(eventbus.EvtEmbeddingDirty, func(id string) {
		select {
		case embeddingDirtyCh <- id:
		default:
		}
	})

	embeddingTableOk = true

	processPendingEmbeddings()

	for {
		select {
		case <-embeddingDirtyCh:
			processPendingEmbeddings()
		case <-time.After(30 * time.Second):
			processPendingEmbeddings()
		}
	}
}

// PrepareEmbeddingSearch 仅检查表与配置并把 embeddingTableOk 置真，不启动后台索引循环。
// 供 CLI 一次性命令（如 search -m 4）使用：StartEmbeddingIndexer 是死循环，不能直接用于会立即退出的进程。
func PrepareEmbeddingSearch() {
	if checkEmbeddingTable() && isEmbeddingEnabled() {
		embeddingTableOk = true
	}
}

type embeddingJob struct {
	texts  []string
	blocks []map[string]any
}

func processPendingEmbeddings() {
	if !isEmbeddingEnabled() {
		return
	}

	embeddingStop.Store(false)
	embeddingErrNotified.Store(false)

	workCh := make(chan embeddingJob, embeddingMaxConcurrency*2)

	var workersWg sync.WaitGroup
	for i := 0; i < embeddingMaxConcurrency; i++ {
		workersWg.Add(1)
		go func() {
			defer workersWg.Done()
			for job := range workCh {
				if embeddingStop.Load() {
					continue
				}
				doEmbedAndStore(job.texts, job.blocks)
			}
		}()
	}

	go func() {
		defer close(workCh)
		for {
			if embeddingStop.Load() {
				return
			}

			// SQL 粗筛下界用最小退避间隔，保证不漏掉到期的重试块；逐块的精确退避在下面 Go 侧再判
			now := time.Now().Unix()
			cutoff := now - int64(embeddingBackoffBase) // embeddingBackoffBase 单位为秒
			results, err := sql.QueryNoLimitArgs(stmtPendingBlocks, embeddingMaxFailCount, cutoff)
			if err != nil {
				logging.LogErrorf("query pending embedding blocks failed: %s", err)
				return
			}

			if 1 > len(results) {
				return
			}

			var texts []string
			var blocks []map[string]any
			anySubmitted := false   // 本轮是否向 workCh 提交过 job
			backoffSkipped := 0     // 因未到退避时间被跳过的块数（这类块状态不变，下轮还会被捞出）
			minRemaining := int64(embeddingBackoffMax) // 这些块中最近的剩余等待秒数（embeddingBackoffMax 单位为秒）
			for _, row := range results {
				id, _ := row["id"].(string)
				rootID, _ := row["root_id"].(string)
				box, _ := row["box"].(string)
				path, _ := row["path"].(string)
				updated, _ := row["updated"].(string)
				content, _ := row["content"].(string)

				// 失败过的块按各自 fail_count 精确判断是否到退避时间，未到期则本轮跳过
				failCount, _ := row["fail_count"].(int64)
				lastTried, _ := row["last_tried"].(int64)
				if failCount > 0 {
					if failCount >= embeddingMaxFailCount {
						continue // 永久失败，不再调度
					}
					required := int64(embeddingBackoffFor(int(failCount)) / time.Second)
					if elapsed := now - lastTried; elapsed < required {
						backoffSkipped++
						if remaining := required - elapsed; remaining < minRemaining {
							minRemaining = remaining
						}
						continue // 未到该块的退避时间
					}
				}

				matcher := getEmbeddingIgnoreMatcher()
				if (nil != matcher && matcher.MatchesPath("/"+box+path)) ||
					len(content) < embeddingMinTextLen || len(content) > embeddingMaxContentLen {
					sql.Exec("INSERT OR IGNORE INTO block_embeddings (id, root_id, box, path, embedding, model, content_len, updated, fail_count, last_tried) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)",
						id, rootID, box, path, []byte{}, embeddingModel(), 0, updated)
					continue
				}
				row["plain_text"] = content
				texts = append(texts, content)
				blocks = append(blocks, row)

				if len(texts) >= embeddingBatchSize {
					workCh <- embeddingJob{texts: texts, blocks: blocks}
					anySubmitted = true
					texts = nil
					blocks = nil
				}
			}
			if len(texts) > 0 {
				workCh <- embeddingJob{texts: texts, blocks: blocks}
				anySubmitted = true
			}

			// 本轮没有提交任何 job，且全部是被退避跳过的块：这些块状态没变，下轮 SQL 还会捞出同样的块，
			// 直接进下一轮会 CPU 忙等 + 高频 DB 查询。sleep 到最近的到期时间再继续，期间检查熔断以便及时退出。
			if !anySubmitted && backoffSkipped > 0 {
				wait := time.Duration(minRemaining) * time.Second
				if wait < time.Second {
					wait = time.Second
				}
				// 分段 sleep，每秒检查一次 embeddingStop，熔断时尽快退出
				for wait > 0 && !embeddingStop.Load() {
					step := wait
					if step > time.Second {
						step = time.Second
					}
					time.Sleep(step)
					wait -= step
				}
			}
		}
	}()

	workersWg.Wait()
}

// stmtPendingBlocks 捞取待嵌入块，分两类：
//  1. 从未尝试过（e.id IS NULL）；
//  2. 失败过、未达永久失败阈值、且距上次尝试已超过退避间隔（e.last_tried < ?）。
// 参数顺序：?1=maxFailCount，?2=now-backoff（仅作 fail_count>0 块的粗筛下界，精确退避由 Go 侧按每块 fail_count 计算）。
const stmtPendingBlocks = "SELECT b.id, b.root_id, b.box, b.path, b.content, b.updated, " +
	"COALESCE(e.fail_count, 0) AS fail_count, COALESCE(e.last_tried, 0) AS last_tried " +
	"FROM blocks b " +
	"LEFT JOIN block_embeddings e ON b.id = e.id " +
	"WHERE e.id IS NULL " +
	"OR (e.fail_count > 0 AND e.fail_count < ? AND e.last_tried < ?) " +
	"ORDER BY fail_count ASC, b.updated DESC LIMIT 100"

// embeddingBackoffFor 返回给定失败次数对应的退避间隔（首次失败 fail_count=1 对应 base）。
func embeddingBackoffFor(failCount int) time.Duration {
	if failCount < 1 {
		return time.Duration(embeddingBackoffBase) * time.Second
	}
	shift := failCount - 1
	if shift > 20 {
		shift = 20 // 防溢出
	}
	d := embeddingBackoffBase << uint(shift)
	if d > embeddingBackoffMax || d < 0 {
		return time.Duration(embeddingBackoffMax) * time.Second
	}
	return time.Duration(d) * time.Second
}

func encodeVector(vec []float32) []byte {
	buf := make([]byte, len(vec)*embeddingVectorDim)
	for i, v := range vec {
		binary.LittleEndian.PutUint32(buf[i*embeddingVectorDim:], math.Float32bits(v))
	}
	return buf
}

func decodeVector(b []byte) []float32 {
	if len(b) == 0 {
		return nil
	}
	return unsafe.Slice((*float32)(unsafe.Pointer(&b[0])), len(b)/embeddingVectorDim)
}

func doEmbedAndStore(texts []string, blocks []map[string]any) {
	vectors, err := util.BatchGetEmbeddings(texts, embeddingKey(), embeddingBaseURL(), embeddingModel(), embeddingTimeout())
	if err != nil {
		// 任何 API 错误（含模型不存在/鉴权失败/限流/网络异常）都熔断本轮，避免连接风暴
		embeddingStop.Store(true)
		logging.LogErrorf("create embeddings failed, stop this round: %s", err)
		// 多个 worker 可能并发失败，用 CAS 保证本轮只向用户提示一次
		if embeddingErrNotified.CompareAndSwap(false, true) {
			util.PushErrMsg("Embedding request failed, indexing paused. Please check AI embedding config.", 5000)
		}

		// 失败块记录 fail_count/last_tried，使其进入按各自退避节奏的重试队列，而非被反复无界重试
		now := time.Now().Unix()
		for _, row := range blocks {
			id, _ := row["id"].(string)
			rootID, _ := row["root_id"].(string)
			box, _ := row["box"].(string)
			path, _ := row["path"].(string)
			updated, _ := row["updated"].(string)
			// 先确保占位行存在（INSERT OR IGNORE 不覆盖已有行），再累加失败计数
			sql.Exec("INSERT OR IGNORE INTO block_embeddings (id, root_id, box, path, embedding, model, content_len, updated, fail_count, last_tried) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)",
				id, rootID, box, path, []byte{}, embeddingModel(), 0, updated)
			sql.Exec("UPDATE block_embeddings SET fail_count = fail_count + 1, last_tried = ?, embedding = ?, model = ?, content_len = 0 WHERE id = ?",
				now, []byte{}, embeddingModel(), id)
		}
		return
	}

	for i, row := range blocks {
		id, _ := row["id"].(string)
		rootID, _ := row["root_id"].(string)
		box, _ := row["box"].(string)
		path, _ := row["path"].(string)
		updated, _ := row["updated"].(string)
		plainText, _ := row["plain_text"].(string)

		buf := encodeVector(vectors[i])

		// 成功则整行重写，fail_count/last_tried 复位为 0
		err = sql.Exec("INSERT OR REPLACE INTO block_embeddings (id, root_id, box, path, embedding, model, content_len, updated, fail_count, last_tried) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)",
			id, rootID, box, path, buf, embeddingModel(), len(plainText), updated)
		if err != nil {
			logging.LogErrorf("store embedding failed for block [%s]: %s", id, err)
		}
	}
}

func getEmbeddingIgnoreMatcher() *ignore.GitIgnore {
	if embeddingIgnoreLoaded {
		return embeddingIgnoreMatcher
	}

	embeddingIgnoreLock.Lock()
	defer embeddingIgnoreLock.Unlock()

	if embeddingIgnoreLoaded {
		return embeddingIgnoreMatcher
	}

	embeddingIgnoreLoaded = true
	embeddingIgnorePath := filepath.Join(util.DataDir, ".siyuan", "embeddingignore")
	if !gulu.File.IsExist(embeddingIgnorePath) {
		return nil
	}

	data, err := os.ReadFile(embeddingIgnorePath)
	if err != nil {
		logging.LogErrorf("read embeddingignore [%s] failed: %s", embeddingIgnorePath, err)
		return nil
	}

	dataStr := string(data)
	dataStr = strings.ReplaceAll(dataStr, "\r\n", "\n")
	lines := strings.Split(dataStr, "\n")

	embeddingIgnoreMatcher = ignore.CompileIgnoreLines(lines...)
	return embeddingIgnoreMatcher
}

func cosineSimilarity(a, b []float32) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}

	var dotProduct, normA, normB float64
	for i := range a {
		dotProduct += float64(a[i]) * float64(b[i])
		normA += float64(a[i]) * float64(a[i])
		normB += float64(b[i]) * float64(b[i])
	}

	if normA == 0 || normB == 0 {
		return 0
	}

	return float32(dotProduct / (math.Sqrt(normA) * math.Sqrt(normB)))
}

type scoredBlock struct {
	id    string
	score float32
}

type scoredHeap []scoredBlock

func (h scoredHeap) Len() int           { return len(h) }
func (h scoredHeap) Less(i, j int) bool { return h[i].score < h[j].score } // min-heap
func (h scoredHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *scoredHeap) Push(x any) {
	*h = append(*h, x.(scoredBlock))
}
func (h *scoredHeap) Pop() any {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

func SemanticSearchBlock(query string, boxes, paths []string, types, subTypes map[string]bool, page, pageSize int) (blocks []*Block, matchedBlockCount, matchedRootCount, pageCount int) {
	blocks = []*Block{}

	if !embeddingTableOk || !isEmbeddingEnabled() || "" == query {
		return
	}

	vectors, err := util.BatchGetEmbeddings([]string{query}, embeddingKey(), embeddingBaseURL(), embeddingModel(), embeddingTimeout())
	if err != nil || 1 > len(vectors) {
		logging.LogErrorf("get query embedding failed")
		return
	}
	queryVec := vectors[0]

	boxFilter := buildBoxesFilter(boxes, "be.")
	pathFilter := buildPathsFilter(paths, "be.")
	typeFilter := buildTypeFilter(types, subTypes, "b.")
	hasFilter := 0 < len(boxes) || 0 < len(paths) || 0 < len(types)
	hasTypeFilter := 0 < len(types)

	numWorkers := runtime.GOMAXPROCS(0)
	if numWorkers < 1 {
		numWorkers = 1
	}

	topK := page * pageSize
	h := &scoredHeap{}
	heap.Init(h)

	scanSize := 4096
	cursor := int64(0)

	for {
		var q string
		if hasFilter {
			q = fmt.Sprintf("SELECT be.rowid, be.id, be.embedding FROM block_embeddings be JOIN blocks b ON be.id = b.id WHERE be.embedding IS NOT NULL AND length(be.embedding) > 0 AND be.rowid > %d", cursor)
			if hasTypeFilter {
				q += " AND " + typeFilter
			}
			q += boxFilter + pathFilter
			q += fmt.Sprintf(" ORDER BY be.rowid LIMIT %d", scanSize)
		} else {
			q = fmt.Sprintf("SELECT rowid, id, embedding FROM block_embeddings WHERE embedding IS NOT NULL AND length(embedding) > 0 AND rowid > %d ORDER BY rowid LIMIT %d", cursor, scanSize)
		}
		rows, qErr := sql.QueryNoLimit(q)
		if qErr != nil {
			logging.LogErrorf("query embeddings for search failed: %s", qErr)
			break
		}
		if 1 > len(rows) {
			break
		}

		rawCursor, _ := rows[len(rows)-1]["rowid"].(int64)
		if rawCursor > cursor {
			cursor = rawCursor
		}

		chunkSize := (len(rows) + numWorkers - 1) / numWorkers
		scoredCh := make(chan []scoredBlock, numWorkers)
		var wg sync.WaitGroup

		for w := 0; w < numWorkers; w++ {
			start := w * chunkSize
			end := start + chunkSize
			if end > len(rows) {
				end = len(rows)
			}
			if start >= end {
				continue
			}

			wg.Add(1)
			go func(chunk []map[string]any) {
				defer wg.Done()
				local := make([]scoredBlock, 0, len(chunk))
				for _, row := range chunk {
					embRaw := row["embedding"].([]byte)
					if len(embRaw) == 0 {
						continue
					}
					buf := make([]byte, len(embRaw))
					copy(buf, embRaw)
					vec := decodeVector(buf)
					score := cosineSimilarity(queryVec, vec)
					id, _ := row["id"].(string)
					local = append(local, scoredBlock{id: id, score: score})
				}
				scoredCh <- local
			}(rows[start:end])
		}

		wg.Wait()
		close(scoredCh)

		for ch := range scoredCh {
			for _, s := range ch {
				if h.Len() < topK {
					heap.Push(h, s)
				} else if s.score > (*h)[0].score {
					heap.Pop(h)
					heap.Push(h, s)
				}
			}
		}
	}

	matchedBlockCount = h.Len()
	if 1 > matchedBlockCount {
		pageCount = 0
		return
	}

	result := make([]scoredBlock, h.Len())
	for i := len(result) - 1; i >= 0; i-- {
		result[i] = heap.Pop(h).(scoredBlock)
	}

	offset := (page - 1) * pageSize
	if offset >= len(result) {
		pageCount = (matchedBlockCount + pageSize - 1) / pageSize
		return
	}

	end := offset + pageSize
	if end > len(result) {
		end = len(result)
	}

	var topIDs []string
	for i := offset; i < end; i++ {
		topIDs = append(topIDs, result[i].id)
	}

	sqlBlocks := sql.GetBlocks(topIDs)
	rootIDSet := map[string]bool{}
	for _, b := range sqlBlocks {
		rootIDSet[b.RootID] = true
		blocks = append(blocks, fromSQLBlock(b, "", 36))
	}
	matchedRootCount = len(rootIDSet)
	pageCount = (matchedBlockCount + pageSize - 1) / pageSize

	return
}

func isEmbeddingEnabled() bool {
	return nil != Conf.AI.Embedding && Conf.AI.Embedding.Enabled && len(Conf.AI.Embedding.APIKey) > 0
}

func embeddingKey() string {
	if nil != Conf.AI.Embedding && Conf.AI.Embedding.Enabled && "" != Conf.AI.Embedding.APIKey {
		return Conf.AI.Embedding.APIKey
	}
	if v := os.Getenv("SIYUAN_OPENAI_EMBEDDING_API_KEY"); "" != v {
		return v
	}
	return ""
}

func embeddingBaseURL() string {
	if nil != Conf.AI.Embedding && Conf.AI.Embedding.Enabled && "" != Conf.AI.Embedding.BaseURL {
		return Conf.AI.Embedding.BaseURL
	}
	if v := os.Getenv("SIYUAN_OPENAI_EMBEDDING_BASE_URL"); "" != v {
		return v
	}
	return ""
}

func embeddingTimeout() int {
	if nil != Conf.AI.Embedding && Conf.AI.Embedding.Enabled && 0 < Conf.AI.Embedding.Timeout {
		return Conf.AI.Embedding.Timeout
	}
	return 30
}

func embeddingModel() string {
	if nil != Conf.AI.Embedding && Conf.AI.Embedding.Enabled && "" != Conf.AI.Embedding.Name {
		return Conf.AI.Embedding.Name
	}
	if v := os.Getenv("SIYUAN_OPENAI_EMBEDDING_MODEL"); "" != v {
		return v
	}
	return ""
}
