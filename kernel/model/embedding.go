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
	"github.com/siyuan-note/siyuan/kernel/task"
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

	// block_embeddings.ignored_type 取值：区分块被跳过未嵌入的原因
	embeddingIgnoredNone   = 0 // 未忽略（正常嵌入或失败重试中）
	embeddingIgnoredByLen  = 1 // 内容长度超限（< 7 或 > 12000 字符）
	embeddingIgnoredByConf = 2 // 被 .siyuan/embeddingignore 配置匹配
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

	// embeddingIndexerRunning 标记后台索引器死循环是否已在运行，避免 fullReindexEmbedding 重复启动多个 goroutine。
	// 启动时若嵌入未启用，StartEmbeddingIndexer 会直接 return，此标志保持 false；用户后续启用并触发重建时据此决定是否启动。
	embeddingIndexerRunning atomic.Bool
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

	// CAS 防止重复启动：若死循环已在运行（如重建按钮触发），直接返回，避免重复注册订阅者和启动多个 goroutine
	if !embeddingIndexerRunning.CompareAndSwap(false, true) {
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
	for range embeddingMaxConcurrency {
		workersWg.Go(func() {
			for job := range workCh {
				if embeddingStop.Load() {
					// 本轮已熔断（其它 worker 处理失败触发），这些积压 job 里的块不能直接丢弃，
					// 否则它们仍为 e.id IS NULL，下轮被反复捞出却永远不被写行。按失败处理写占位行。
					recordFailedEmbedding(job.blocks, "round stopped due to earlier failure in this round")
					continue
				}
				doEmbedAndStore(job.texts, job.blocks)
			}
		})
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
			anySubmitted := false                      // 本轮是否向 workCh 提交过 job
			backoffSkipped := 0                        // 因未到退避时间被跳过的块数（这类块状态不变，下轮还会被捞出）
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
				if nil != matcher && matcher.MatchesPath("/"+box+path) {
					// 被 .siyuan/embeddingignore 配置匹配，配置忽略优先于长度忽略
					sql.Exec("INSERT OR IGNORE INTO block_embeddings (id, root_id, box, path, embedding, model, content_len, updated, fail_count, last_tried, ignored_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)",
						id, rootID, box, path, []byte{}, embeddingModel(), 0, updated, embeddingIgnoredByConf)
					continue
				}
				if len(content) < embeddingMinTextLen || len(content) > embeddingMaxContentLen {
					// 内容长度超限（过短或过长），长度忽略
					sql.Exec("INSERT OR IGNORE INTO block_embeddings (id, root_id, box, path, embedding, model, content_len, updated, fail_count, last_tried, ignored_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)",
						id, rootID, box, path, []byte{}, embeddingModel(), 0, updated, embeddingIgnoredByLen)
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
				wait := max(time.Duration(minRemaining)*time.Second, time.Second)
				// 分段 sleep，每秒检查一次 embeddingStop，熔断时尽快退出
				for wait > 0 && !embeddingStop.Load() {
					step := min(wait, time.Second)
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
//
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
	shift := min(failCount-1,
		// 防溢出
		20)
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

// recordFailedEmbedding 把一批块标记为失败（fail_count+1，写空 embedding），并熔断本轮 + 提示用户。
// 用于 API 调用出错或返回向量数与输入不匹配时的统一失败处理。
func recordFailedEmbedding(blocks []map[string]any, reason string) {
	embeddingStop.Store(true)
	logging.LogErrorf("create embeddings failed (%s), stop this round", reason)
	// 多个 worker 可能并发失败，用 CAS 保证本轮只向用户提示一次
	if embeddingErrNotified.CompareAndSwap(false, true) {
		util.PushErrMsg("Embedding request failed, indexing paused. Please check AI embedding config.", 5000)
	}

	now := time.Now().Unix()
	for _, row := range blocks {
		id, _ := row["id"].(string)
		rootID, _ := row["root_id"].(string)
		box, _ := row["box"].(string)
		path, _ := row["path"].(string)
		updated, _ := row["updated"].(string)
		// 先确保占位行存在（INSERT OR IGNORE 不覆盖已有行），再累加失败计数
		sql.Exec("INSERT OR IGNORE INTO block_embeddings (id, root_id, box, path, embedding, model, content_len, updated, fail_count, last_tried, ignored_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)",
			id, rootID, box, path, []byte{}, embeddingModel(), 0, updated)
		sql.Exec("UPDATE block_embeddings SET fail_count = fail_count + 1, last_tried = ?, embedding = ?, model = ?, content_len = 0, ignored_type = 0 WHERE id = ?",
			now, []byte{}, embeddingModel(), id)
	}
}

func doEmbedAndStore(texts []string, blocks []map[string]any) {
	vectors, err := util.BatchGetEmbeddings(texts, embeddingKey(), embeddingBaseURL(), embeddingModel(), embeddingDimensions(), embeddingTimeout())
	if err != nil {
		// 任何 API 错误（含模型不存在/鉴权失败/限流/网络异常）都熔断本轮，避免连接风暴
		recordFailedEmbedding(blocks, err.Error())
		return
	}

	// 部分 OpenAI 兼容 API 会对重复输入去重，返回少于输入数量的向量。此时无法对齐，整批按失败处理，避免越界 panic
	if len(vectors) != len(blocks) {
		recordFailedEmbedding(blocks, fmt.Sprintf("count mismatch: requested %d but got %d", len(blocks), len(vectors)))
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

		// 成功则整行重写，fail_count/last_tried/ignored_type 复位为 0
		err = sql.Exec("INSERT OR REPLACE INTO block_embeddings (id, root_id, box, path, embedding, model, content_len, updated, fail_count, last_tried, ignored_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)",
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

	embeddingIgnorePath := filepath.Join(util.DataDir, ".siyuan", "embeddingignore")
	if !gulu.File.IsExist(embeddingIgnorePath) {
		return nil // 文件不存在时不置 loaded 标志，允许用户后续创建后重新加载
	}

	data, err := os.ReadFile(embeddingIgnorePath)
	if err != nil {
		logging.LogErrorf("read embeddingignore [%s] failed: %s", embeddingIgnorePath, err)
		return nil // 读取失败时也不置标志，下次调用会重试
	}

	dataStr := string(data)
	dataStr = strings.ReplaceAll(dataStr, "\r\n", "\n")
	lines := strings.Split(dataStr, "\n")

	embeddingIgnoreMatcher = ignore.CompileIgnoreLines(lines...)
	embeddingIgnoreLoaded = true // 成功加载后才置标志，避免文件后建却永不加载
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

	vectors, err := util.BatchGetEmbeddings([]string{query}, embeddingKey(), embeddingBaseURL(), embeddingModel(), embeddingDimensions(), embeddingTimeout())
	if err != nil || 1 > len(vectors) {
		logging.LogErrorf("get query embedding failed")
		return
	}
	queryVec := vectors[0]

	boxFilter, boxArgs := buildBoxesFilter(boxes, "be.")
	pathFilter, pathArgs := buildPathsFilter(paths, "be.")
	boxDocFilter, boxDocArgs := buildRootIDExclusionFilter(hiddenBoxDocRootIDs(), "b.")
	typeFilter := buildTypeFilter(types, subTypes, "b.")
	hasFilter := 0 < len(boxes) || 0 < len(paths) || 0 < len(types) || "" != boxDocFilter
	hasTypeFilter := 0 < len(types)

	numWorkers := max(runtime.GOMAXPROCS(0), 1)

	// 向量召回候选数：启用重排时固定召回 candidateCount 条，保证所有分页基于同一候选集；否则只取当前页所需。
	topK := page * pageSize
	if isRerankEnabled() {
		topK = rerankCandidateCount()
	}
	h := &scoredHeap{}
	heap.Init(h)

	scanSize := 4096
	cursor := int64(0)

	for {
		var q string
		var args []any
		if hasFilter {
			q = fmt.Sprintf("SELECT be.rowid, be.id, be.embedding FROM block_embeddings be JOIN blocks b ON be.id = b.id WHERE be.embedding IS NOT NULL AND length(be.embedding) > 0 AND be.rowid > %d", cursor)
			if hasTypeFilter {
				q += " AND " + typeFilter
			}
			q += boxFilter + pathFilter + boxDocFilter
			// 过滤值通过绑定参数传递，避免 SQL 拼接注入
			args = append(append(append([]any{}, boxArgs...), pathArgs...), boxDocArgs...)
			q += fmt.Sprintf(" ORDER BY be.rowid LIMIT %d", scanSize)
		} else {
			q = fmt.Sprintf("SELECT rowid, id, embedding FROM block_embeddings WHERE embedding IS NOT NULL AND length(embedding) > 0 AND rowid > %d ORDER BY rowid LIMIT %d", cursor, scanSize)
		}
		rows, qErr := sql.QueryNoLimitArgs(q, args...)
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
			end := min(start+chunkSize, len(rows))
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

	// 按向量相似度降序取出全部候选块 ID。重排启用时 result 已是固定的 candidateCount；
	// 未启用时 result 即当前页所需，后续分页逻辑统一处理。
	var candidateIDs []string
	for _, s := range result {
		candidateIDs = append(candidateIDs, s.id)
	}

	sqlBlocks := sql.GetBlocks(candidateIDs)

	// 重排：对 query 与候选块文本逐对精排，失败则降级保留向量相似度原序，不阻断搜索。
	// 注意 GetBlocks 的返回顺序未必与 candidateIDs 一致，重排以返回的 sqlBlocks 为准。
	sqlBlocks = rerankSqlBlocks(query, sqlBlocks)

	offset := (page - 1) * pageSize
	if offset >= len(sqlBlocks) {
		pageCount = (matchedBlockCount + pageSize - 1) / pageSize
		return
	}

	end := min(offset+pageSize, len(sqlBlocks))

	rootIDSet := map[string]bool{}
	for i := offset; i < end; i++ {
		b := sqlBlocks[i]
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

// rerankSqlBlocks 用重排模型对候选块按 query 逐对精排。未启用或调用失败时原样返回（降级为向量相似度排序）。
// 重排服务以块的 Content（嵌入向量所代表的纯文本）作为文档文本，跨页排序一致：rerank 对每个
// query-doc 对独立打分，分数不随候选集大小变化。
func rerankSqlBlocks(query string, sqlBlocks []*sql.Block) []*sql.Block {
	if !isRerankEnabled() || len(sqlBlocks) < 2 {
		return sqlBlocks
	}

	documents := make([]string, len(sqlBlocks))
	for i, b := range sqlBlocks {
		documents[i] = b.Content
	}

	// topN=0 表示不传 top_n，要求服务端返回全部文档评分，避免被服务端 top_n 上限截断
	indices, _, err := util.Rerank(query, documents, rerankKey(), rerankEndpoint(), rerankModel(), 0, rerankTimeout())
	if nil != err {
		logging.LogErrorf("rerank failed, fallback to vector similarity order: %s", err)
		return sqlBlocks
	}
	if len(indices) != len(sqlBlocks) {
		// 服务端返回数量与输入不符，按原序降级，避免错位
		logging.LogErrorf("rerank returned %d indices for %d documents, fallback", len(indices), len(sqlBlocks))
		return sqlBlocks
	}

	// 防御重复 index：服务端不应返回重复下标，但若出现则降级，避免某些块丢失、某些块重复
	seen := make(map[int]bool, len(indices))
	for _, idx := range indices {
		if seen[idx] {
			logging.LogErrorf("rerank returned duplicate index %d, fallback", idx)
			return sqlBlocks
		}
		seen[idx] = true
	}

	reranked := make([]*sql.Block, len(indices))
	for i, idx := range indices {
		reranked[i] = sqlBlocks[idx]
	}
	return reranked
}

// ReindexEmbedding 清空嵌入向量表并触发后台索引器重新计算所有块。异步执行：只入队任务后立即返回。
func ReindexEmbedding() {
	task.AppendTask(task.DatabaseIndexEmbeddingFull, fullReindexEmbedding)
}

// fullReindexEmbedding 实际的重建逻辑，由任务队列调度执行。
// 只 DELETE 数据行保留表结构（不能 DROP，DROP 会连带重建 blocks 等所有表），
// 清空后所有块满足 e.id IS NULL，常驻索引器下一轮自动全量重嵌。
func fullReindexEmbedding() {
	if !isEmbeddingEnabled() {
		logging.LogWarnf("embedding not enabled, skip reindex")
		return
	}
	if !checkEmbeddingTable() {
		logging.LogWarnf("block_embeddings table not available, skip reindex")
		return
	}
	if err := sql.Exec("DELETE FROM block_embeddings"); err != nil {
		logging.LogErrorf("clear block_embeddings failed: %s", err)
		return
	}
	logging.LogInfof("embedding vectors cleared, indexer will re-embed all blocks")

	// 若后台索引器死循环未运行（用户启动内核时嵌入未启用、随后才开启并点重建），这里补启动。
	// StartEmbeddingIndexer 内部用 CAS 保证只启动一个死循环。已运行则 Publish 唤醒立即补齐，不必等 30s 兜底轮询。
	if !embeddingIndexerRunning.Load() {
		go StartEmbeddingIndexer()
	} else {
		eventbus.Publish(eventbus.EvtEmbeddingDirty, "")
	}
}

// RetryFailedEmbedding 删除所有失败块的行，使其立即回到主循环重嵌。异步执行：只入队任务后立即返回。
// 与 ReindexEmbedding 的区别：只删 fail_count>0 的失败块（embedding 为空，无有效向量），已成功的向量不动。
func RetryFailedEmbedding() {
	task.AppendTask(task.DatabaseIndexEmbeddingRetryFailed, retryFailedEmbedding)
}

// retryFailedEmbedding 实际的重试逻辑，由任务队列调度执行。
// 失败块的 embedding 为空（失败时写 []byte{}），删除不丢有效向量；删行后块重新满足 pending 查询的 e.id IS NULL。
func retryFailedEmbedding() {
	if !isEmbeddingEnabled() {
		logging.LogWarnf("embedding not enabled, skip retry failed")
		return
	}
	if !checkEmbeddingTable() {
		logging.LogWarnf("block_embeddings table not available, skip retry failed")
		return
	}
	if err := sql.Exec("DELETE FROM block_embeddings WHERE fail_count > 0"); err != nil {
		logging.LogErrorf("delete failed embedding rows failed: %s", err)
		return
	}
	logging.LogInfof("failed embedding rows cleared, indexer will retry these blocks")
	// 唤醒常驻索引器立即补齐
	if embeddingIndexerRunning.Load() {
		eventbus.Publish(eventbus.EvtEmbeddingDirty, "")
	} else {
		go StartEmbeddingIndexer()
	}
}

// EmbeddingStat 嵌入索引进度统计，供设置页展示。
type EmbeddingStat struct {
	Total           int  `json:"total"`           // blocks 表总块数（分母）
	Indexed         int  `json:"indexed"`         // 有效向量数（length(embedding)>0）
	Pending         int  `json:"pending"`         // 待索引块数（blocks 中无对应 block_embeddings 行的）
	Failed          int  `json:"failed"`          // 失败块数（fail_count>0）
	IgnoredByLen    int  `json:"ignoredByLen"`    // 长度忽略（内容过短或过长，ignored_type=1）
	IgnoredByConfig int  `json:"ignoredByConfig"` // 配置忽略（被 .siyuan/embeddingignore 匹配，ignored_type=2）
	Enabled         bool `json:"enabled"`         // 是否已启用嵌入
}

// GetEmbeddingStat 查询嵌入索引进度统计。表不存在或未启用时返回零值统计。
func GetEmbeddingStat() (ret *EmbeddingStat) {
	ret = &EmbeddingStat{Enabled: isEmbeddingEnabled()}
	if !checkEmbeddingTable() {
		return
	}

	// 一条 SQL 同时算 total 和 pending（pending = blocks 中没有对应嵌入行的）
	// COALESCE 处理 LEFT JOIN 的 NULL；用带 ok 的安全断言，避免 driver 返回类型差异导致 panic
	rows, err := sql.QueryNoLimit("SELECT COUNT(*) AS total, SUM(CASE WHEN e.id IS NULL THEN 1 ELSE 0 END) AS pending FROM blocks b LEFT JOIN block_embeddings e ON b.id = e.id")
	if err != nil || 1 > len(rows) {
		logging.LogErrorf("query embedding total/pending stat failed: %s", err)
		return
	}
	if total, ok := rows[0]["total"].(int64); ok {
		ret.Total = int(total)
	}
	if pending, ok := rows[0]["pending"].(int64); ok {
		ret.Pending = int(pending)
	}

	// 已索引（有效向量）
	rows, err = sql.QueryNoLimit("SELECT COUNT(*) AS c FROM block_embeddings WHERE length(embedding) > 0")
	if err == nil && 0 < len(rows) {
		if c, ok := rows[0]["c"].(int64); ok {
			ret.Indexed = int(c)
		}
	}

	// 失败块（含失败重试中 + 永久失败，统一计入让用户感知）
	rows, err = sql.QueryNoLimit("SELECT COUNT(*) AS c FROM block_embeddings WHERE fail_count > 0")
	if err == nil && 0 < len(rows) {
		if c, ok := rows[0]["c"].(int64); ok {
			ret.Failed = int(c)
		}
	}

	// 忽略块按原因分别统计：ignored_type=1 为长度忽略，=2 为配置忽略
	rows, err = sql.QueryNoLimit("SELECT SUM(CASE WHEN ignored_type = 1 THEN 1 ELSE 0 END) AS by_len, SUM(CASE WHEN ignored_type = 2 THEN 1 ELSE 0 END) AS by_conf FROM block_embeddings WHERE ignored_type > 0")
	if err == nil && 0 < len(rows) {
		if byLen, ok := rows[0]["by_len"].(int64); ok {
			ret.IgnoredByLen = int(byLen)
		}
		if byConf, ok := rows[0]["by_conf"].(int64); ok {
			ret.IgnoredByConfig = int(byConf)
		}
	}
	return
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

// embeddingDimensions 返回配置的输出向量维度。0 表示用模型默认维度（不传 dimensions 参数给 API），
// 仅 text-embedding-3 及以上模型支持自定义维度。文档向量与查询向量必须用相同维度，否则相似度计算会维度不匹配。
func embeddingDimensions() int {
	if nil != Conf.AI.Embedding && Conf.AI.Embedding.Enabled && 0 < Conf.AI.Embedding.Dimensions {
		return Conf.AI.Embedding.Dimensions
	}
	return 0
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
