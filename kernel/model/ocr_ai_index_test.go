//go:build fts5

package model

import (
	"context"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func testAIOCRAssetIndex(t *testing.T, path, blockID string) {
	t.Helper()
	previousAI := Conf.AI
	defer func() { Conf.AI = previousAI }()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":"aiocrkeyword\nsecond  column"}}]}`)
	}))
	defer server.Close()
	Conf.AI = conf.NewAI()
	Conf.AI.Agent.ModelID = "vision"
	Conf.AI.Providers = []*conf.Provider{{ID: "provider", Enabled: true, APIKey: "test", BaseURL: server.URL + "/v1",
		Models: []*conf.Model{{ID: "vision", Enabled: true, Name: "vision-test"}}}}
	file, err := os.Create(filepath.Join(util.DataDir, filepath.FromSlash(path)))
	if err != nil {
		t.Fatal(err)
	}
	err = png.Encode(file, image.NewRGBA(image.Rect(0, 0, 16, 16)))
	file.Close()
	if err != nil {
		t.Fatal(err)
	}
	text, err := AIOCRAsset(context.Background(), path+"#preview")
	if err != nil || text != "aiocrkeyword\nsecond  column" || util.GetAssetText(path) != text {
		t.Fatalf("AI OCR changed formatting: %q, %v", text, err)
	}
	sql.FlushQueue()
	block := sql.GetBlock(blockID)
	if block == nil || !strings.Contains(block.Content, "aiocrkeyword") {
		t.Fatalf("AI OCR did not update referenced block: %+v", block)
	}
	matches, err := sql.QueryNoLimit("SELECT id FROM blocks_fts WHERE blocks_fts MATCH 'aiocrkeyword'")
	if err != nil || len(matches) != 1 {
		t.Fatalf("AI OCR did not reach full-text search: %v, %v", matches, err)
	}
	matches, err = sql.QueryNoLimit("SELECT id FROM blocks_fts WHERE blocks_fts MATCH 'editedocrkeyword'")
	if err != nil || len(matches) != 0 {
		t.Fatalf("obsolete OCR text remains searchable: %v, %v", matches, err)
	}
	SetOCRAssetText(path, "editedocrkeyword")
	sql.FlushQueue()
}
