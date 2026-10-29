// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestEmbeddingSpaceSearch(t *testing.T) {
	const childEnv = "SIYUAN_TEST_EMBEDDING_SPACE"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestEmbeddingSpaceSearch$", "-test.timeout=60s", "-test.v")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v\n%s", err, output)
		}
		return
	}
	setupFileOperationTest(t)
	Conf.Search.Store(conf.NewSearch())
	Conf.AI.Store(conf.NewAI())
	Conf.AI.Load().Embedding = &conf.Embedding{Enabled: true, APIKey: "test", Name: "model", Dimensions: 2}
	util.TempDir = t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	if err := sql.InitAssetContentDatabase(true); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(sql.CloseDatabase)
	embeddingTableOk = true
	var calls atomic.Int32
	var switchConfig atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if switchConfig.Load() {
			Conf.AI.Load().Embedding.Name = "changed-during-query"
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":[{"embedding":[1,0],"index":0}],"model":"model"}`)
	}))
	defer server.Close()
	Conf.AI.Load().Embedding.BaseURL = server.URL
	space := embeddingSpaceID(server.URL, "model", 2)
	exec := func(q string, args ...any) {
		t.Helper()
		if err := sql.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	for i, item := range []struct {
		space  string
		vector []float32
	}{
		{space, []float32{1, 0}},
		{embeddingSpaceID(server.URL, "other", 2), []float32{1, 0}},
		{embeddingSpaceID(server.URL+"/other", "model", 2), []float32{1, 0}},
		{embeddingSpaceID(server.URL, "model", 3), []float32{1, 0}},
		{"", []float32{1, 0}},
		{space, []float32{1, 0, 0}},
	} {
		id := fmt.Sprintf("2026102710000%d-test%03d", i, i)
		exec("INSERT INTO blocks VALUES (?, '', ?, '', 'box', '/doc.sy', '/Doc', '', '', '', '', 'search content', '', 'search content', 14, 'p', '', '', 0, '1', '1')", id, id)
		exec("INSERT INTO block_embeddings (id, root_id, box, path, embedding, model, space) VALUES (?, ?, 'box', '/doc.sy', ?, 'model', ?)", id, id, encodeVector(item.vector), item.space)
	}
	for _, boxes := range [][]string{nil, {"box"}} {
		blocks, count, _, _ := SemanticSearchBlock("query", boxes, nil, nil, nil, 1, 20, nil, nil)
		if count != 1 || len(blocks) != 1 || blocks[0].ID != "20261027100000-test000" {
			t.Fatalf("boxes=%v: count=%d, blocks=%+v", boxes, count, blocks)
		}
	}
	for _, change := range []string{"model", "endpoint", "dimensions"} {
		cfg := Conf.AI.Load().Embedding
		cfg.Name, cfg.BaseURL, cfg.Dimensions = "model", server.URL, 2
		switch change {
		case "model":
			cfg.Name = "new"
		case "endpoint":
			cfg.BaseURL += "/new"
		case "dimensions":
			cfg.Dimensions = 4
		}
		_, count, _, _ := SemanticSearchBlock("query", nil, nil, nil, nil, 1, 20, nil, nil)
		if count != 0 {
			t.Fatalf("%s mixed old vectors: %d", change, count)
		}
	}
	Conf.AI.Load().Embedding.Name, Conf.AI.Load().Embedding.BaseURL, Conf.AI.Load().Embedding.Dimensions = "model", server.URL, 2
	switchConfig.Store(true)
	_, count, _, _ := SemanticSearchBlock("query", nil, nil, nil, nil, 1, 20, nil, nil)
	if count != 0 || calls.Load() != 6 {
		t.Fatalf("inflight config change: count=%d, calls=%d", count, calls.Load())
	}
	rows, err := sql.QueryNoLimit("SELECT COUNT(*) AS c FROM block_embeddings")
	if err != nil || rows[0]["c"].(int64) != 6 {
		t.Fatalf("old index changed: %v, %v", rows, err)
	}
}
