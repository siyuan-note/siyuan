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
)

var (
	embeddingDirtyCh = make(chan string, 1024)
	embeddingTableOk bool

	embeddingIgnoreLoaded  bool
	embeddingIgnoreMatcher *ignore.GitIgnore
	embeddingIgnoreLock    sync.Mutex

	embeddingStop atomic.Bool
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

type embeddingJob struct {
	texts  []string
	blocks []map[string]any
}

func processPendingEmbeddings() {
	if !isEmbeddingEnabled() {
		return
	}

	embeddingStop.Store(false)

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

			results, err := sql.QueryNoLimit(stmtPendingBlocks)
			if err != nil {
				logging.LogErrorf("query pending embedding blocks failed: %s", err)
				return
			}

			if 1 > len(results) {
				return
			}

			var texts []string
			var blocks []map[string]any
			for _, row := range results {
				id, _ := row["id"].(string)
				rootID, _ := row["root_id"].(string)
				box, _ := row["box"].(string)
				path, _ := row["path"].(string)
				updated, _ := row["updated"].(string)
				content, _ := row["content"].(string)
				matcher := getEmbeddingIgnoreMatcher()
				if (nil != matcher && matcher.MatchesPath("/"+box+path)) ||
					len(content) < embeddingMinTextLen || len(content) > embeddingMaxContentLen {
					sql.Exec("INSERT OR IGNORE INTO block_embeddings (id, root_id, box, path, embedding, model, content_len, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
						id, rootID, box, path, []byte{}, embeddingModel(), 0, updated)
					continue
				}
				row["plain_text"] = content
				texts = append(texts, content)
				blocks = append(blocks, row)

				if len(texts) >= embeddingBatchSize {
					workCh <- embeddingJob{texts: texts, blocks: blocks}
					texts = nil
					blocks = nil
				}
			}
			if len(texts) > 0 {
				workCh <- embeddingJob{texts: texts, blocks: blocks}
			}
		}
	}()

	workersWg.Wait()
}

const stmtPendingBlocks = "SELECT b.id, b.root_id, b.box, b.path, b.content, b.updated FROM blocks b " +
	"LEFT JOIN block_embeddings e ON b.id = e.id " +
	"WHERE e.id IS NULL " +
	"ORDER BY b.updated DESC LIMIT 100"

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
	vectors, err := util.BatchGetEmbeddings(texts, embeddingKey(), embeddingBaseURL(), embeddingModel(), Conf.AI.OpenAI.APITimeout)
	if err != nil {
		if util.IsNetworkError(err) {
			embeddingStop.Store(true)
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

		err = sql.Exec("INSERT OR REPLACE INTO block_embeddings (id, root_id, box, path, embedding, model, content_len, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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

	vectors, err := util.BatchGetEmbeddings([]string{query}, embeddingKey(), embeddingBaseURL(), embeddingModel(), Conf.AI.OpenAI.APITimeout)
	if err != nil || 1 > len(vectors) {
		logging.LogErrorf("get query embedding failed")
		return
	}
	queryVec := vectors[0]

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
		q := fmt.Sprintf("SELECT rowid, id, embedding FROM block_embeddings WHERE embedding IS NOT NULL AND length(embedding) > 0 AND rowid > %d ORDER BY rowid LIMIT %d", cursor, scanSize)
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
	return "" != embeddingKey()
}

func embeddingKey() string {
	if p := Conf.AI.GetEmbeddingProvider(); p != nil && "" != p.APIKey {
		return p.APIKey
	}
	if v := os.Getenv("SIYUAN_OPENAI_EMBEDDING_API_KEY"); "" != v {
		return v
	}
	return ""
}

func embeddingBaseURL() string {
	if p := Conf.AI.GetEmbeddingProvider(); p != nil && "" != p.APIBaseURL {
		return p.APIBaseURL
	}
	if v := os.Getenv("SIYUAN_OPENAI_EMBEDDING_BASE_URL"); "" != v {
		return v
	}
	return ""
}

func embeddingModel() string {
	if p := Conf.AI.GetEmbeddingProvider(); p != nil && "" != p.APIModel {
		return p.APIModel
	}
	if v := os.Getenv("SIYUAN_OPENAI_EMBEDDING_MODEL"); "" != v {
		return v
	}
	return ""
}
