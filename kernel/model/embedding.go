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
	"encoding/binary"
	"math"
	"os"
	"runtime"
	"sort"
	"sync"
	"time"
	"unsafe"

	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	embeddingBatchSize      = 10
	embeddingFetchSize      = 100
	embeddingMaxConcurrency = 8
	embeddingMinTextLen     = 7
	embeddingMaxContentLen  = 12000
	embeddingVectorDim      = 4 // float32 = 4 bytes
)

var (
	embeddingDirtyCh = make(chan string, 1024)
	embeddingTableOk bool
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

	workCh := make(chan embeddingJob, embeddingMaxConcurrency*2)

	var workersWg sync.WaitGroup
	for i := 0; i < embeddingMaxConcurrency; i++ {
		workersWg.Add(1)
		go func() {
			defer workersWg.Done()
			for job := range workCh {
				doEmbedAndStore(job.texts, job.blocks)
			}
		}()
	}

	go func() {
		defer close(workCh)
		for {
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
				if len(content) < embeddingMinTextLen || len(content) > embeddingMaxContentLen {
					sql.Exec("INSERT OR IGNORE INTO block_embeddings (id, root_id, box, path, embedding, model, content_len, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
						id, rootID, box, path, []byte{}, Conf.AI.OpenAI.EmbeddingModel, 0, updated)
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
	vectors, err := util.BatchGetEmbeddings(texts, embeddingKey(), embeddingBaseURL(), Conf.AI.OpenAI.EmbeddingModel, Conf.AI.OpenAI.APITimeout)
	if err != nil {
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
			id, rootID, box, path, buf, Conf.AI.OpenAI.EmbeddingModel, len(plainText), updated)
		if err != nil {
			logging.LogErrorf("store embedding failed for block [%s]: %s", id, err)
		}
	}
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

type embeddingEntry struct {
	id  string
	vec []float32
}

func SemanticSearchBlock(query string, boxes, paths []string, types, subTypes map[string]bool, page, pageSize int) (blocks []*Block, matchedBlockCount, matchedRootCount, pageCount int) {
	blocks = []*Block{}

	if !embeddingTableOk || !isEmbeddingEnabled() || "" == query {
		return
	}

	vectors, err := util.BatchGetEmbeddings([]string{query}, embeddingKey(), embeddingBaseURL(), Conf.AI.OpenAI.EmbeddingModel, Conf.AI.OpenAI.APITimeout)
	if err != nil || 1 > len(vectors) {
		logging.LogErrorf("get query embedding failed")
		return
	}
	queryVec := vectors[0]

	results, err := sql.QueryNoLimit("SELECT id, embedding FROM block_embeddings WHERE embedding IS NOT NULL AND length(embedding) > 0")
	if err != nil {
		logging.LogErrorf("query embeddings for search failed: %s", err)
		return
	}

	var entries []embeddingEntry
	for _, row := range results {
		embRaw := row["embedding"].([]byte)
		if len(embRaw) == 0 {
			continue
		}
		id, _ := row["id"].(string)
		buf := make([]byte, len(embRaw))
		copy(buf, embRaw)
		entries = append(entries, embeddingEntry{id: id, vec: decodeVector(buf)})
	}

	type scoredBlock struct {
		id    string
		score float32
	}

	numWorkers := runtime.GOMAXPROCS(0)
	if numWorkers < 1 {
		numWorkers = 1
	}
	chunkSize := (len(entries) + numWorkers - 1) / numWorkers

	scoredCh := make(chan []scoredBlock, numWorkers)
	var wg sync.WaitGroup

	for w := 0; w < numWorkers; w++ {
		start := w * chunkSize
		end := start + chunkSize
		if end > len(entries) {
			end = len(entries)
		}
		if start >= end {
			continue
		}

		wg.Add(1)
		go func(chunk []embeddingEntry) {
			defer wg.Done()
			local := make([]scoredBlock, len(chunk))
			for i, e := range chunk {
				local[i] = scoredBlock{id: e.id, score: cosineSimilarity(queryVec, e.vec)}
			}
			scoredCh <- local
		}(entries[start:end])
	}

	wg.Wait()
	close(scoredCh)

	var scored []scoredBlock
	for ch := range scoredCh {
		scored = append(scored, ch...)
	}

	sort.Slice(scored, func(i, j int) bool {
		return scored[i].score > scored[j].score
	})

	matchedBlockCount = len(scored)

	offset := (page - 1) * pageSize
	if offset >= len(scored) {
		pageCount = (matchedBlockCount + pageSize - 1) / pageSize
		return
	}

	end := offset + pageSize
	if end > len(scored) {
		end = len(scored)
	}

	var topIDs []string
	for i := offset; i < end; i++ {
		topIDs = append(topIDs, scored[i].id)
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
	if "" != Conf.AI.OpenAI.EmbeddingAPIKey {
		return Conf.AI.OpenAI.EmbeddingAPIKey
	}
	return os.Getenv("SIYUAN_OPENAI_EMBEDDING_API_KEY")
}

func embeddingBaseURL() string {
	if "" != Conf.AI.OpenAI.EmbeddingBaseURL {
		return Conf.AI.OpenAI.EmbeddingBaseURL
	}
	if v := os.Getenv("SIYUAN_OPENAI_EMBEDDING_BASE_URL"); "" != v {
		return v
	}
	return Conf.AI.OpenAI.EmbeddingBaseURL
}
