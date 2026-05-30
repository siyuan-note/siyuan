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
	"encoding/json"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	embeddingBatchSize    = 10
	embeddingFetchSize    = 30
	embeddingMinTextLen   = 7
	embeddingMaxContentLen = 12000
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

func processPendingEmbeddings() {
	if !isEmbeddingEnabled() {
		return
	}

	for {
		results, err := sql.QueryNoLimit(stmtPendingBlocks)
		if err != nil {
			logging.LogErrorf("query pending embedding blocks failed: %s", err)
			return
		}

		if 1 > len(results) {
			return
		}

		var batches [][]map[string]any
		var batch []map[string]any
		for _, row := range results {
			id, _ := row["id"].(string)
			rootID, _ := row["root_id"].(string)
			box, _ := row["box"].(string)
			path, _ := row["path"].(string)
			updated, _ := row["updated"].(string)
			content, _ := row["content"].(string)
			if len(content) < embeddingMinTextLen || len(content) > embeddingMaxContentLen {
				sql.Exec("INSERT OR IGNORE INTO block_embeddings (id, root_id, box, path, embedding, model, content_len, updated) VALUES ('" +
					id + "','" + rootID + "','" + box + "','" + path + "','','" + Conf.AI.OpenAI.EmbeddingModel + "',0,'" + updated + "')")
				continue
			}
			row["plain_text"] = content
			batch = append(batch, row)

			if len(batch) >= embeddingBatchSize {
				batches = append(batches, batch)
				batch = nil
			}
		}
		if len(batch) > 0 {
			batches = append(batches, batch)
		}

		var wg sync.WaitGroup
		for _, bt := range batches {
			wg.Add(1)
			go func(blocks []map[string]any) {
				defer wg.Done()
				var texts []string
				for _, row := range blocks {
					texts = append(texts, row["plain_text"].(string))
				}
				doEmbedAndStore(texts, blocks)
			}(bt)
		}
		wg.Wait()
	}
}

const stmtPendingBlocks = "SELECT b.id, b.root_id, b.box, b.path, b.content, b.updated FROM blocks b " +
	"LEFT JOIN block_embeddings e ON b.id = e.id " +
	"WHERE e.id IS NULL " +
	"ORDER BY b.updated DESC LIMIT 30"

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

		embeddingJSON, err := json.Marshal(vectors[i])
		if err != nil {
			logging.LogErrorf("marshal embedding failed for block [%s]: %s", id, err)
			continue
		}

		escaped := func(s string) string { return strings.ReplaceAll(s, "'", "''") }

		stmt := "INSERT OR REPLACE INTO block_embeddings (id, root_id, box, path, embedding, model, content_len, updated) VALUES ('" +
			escaped(id) + "', '" + escaped(rootID) + "', '" + escaped(box) + "', '" + escaped(path) + "', '" +
			escaped(string(embeddingJSON)) + "', '" + escaped(Conf.AI.OpenAI.EmbeddingModel) + "', " +
			strconv.Itoa(len(plainText)) + ", '" + escaped(updated) + "')"

		err = sql.Exec(stmt)
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

	results, err := sql.QueryNoLimit("SELECT id, embedding FROM block_embeddings")
	if err != nil {
		logging.LogErrorf("query embeddings for search failed: %s", err)
		return
	}

	type scoredBlock struct {
		id    string
		score float32
	}
	var scored []scoredBlock

	for _, row := range results {
		embStr, _ := row["embedding"].([]byte)
		if embStr == nil {
			if s, ok := row["embedding"].(string); ok {
				embStr = []byte(s)
			} else {
				continue
			}
		}
		var vec []float32
		if err := json.Unmarshal(embStr, &vec); err != nil {
			continue
		}
		score := cosineSimilarity(queryVec, vec)
		id, _ := row["id"].(string)
		scored = append(scored, scoredBlock{id: id, score: score})
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
