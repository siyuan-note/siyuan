//go:build fts5

package model

import (
	"context"
	"errors"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func testAIOCRAssetIndex(t *testing.T, path, blockID string) {
	t.Helper()
	previousAI := Conf.AI
	previousOCR := Conf.GetOCR()
	defer func() { Conf.AI, Conf.OCR = previousAI, &previousOCR }()
	calls := 0
	var beforeResponse func()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if beforeResponse != nil {
			beforeResponse()
		}
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
	Conf.OCR = &conf.OCR{Provider: "ai", Model: "tiny", AIModelID: "vision", Auto: true}
	for _, test := range []struct {
		name   string
		change func()
		want   string
	}{
		{"automatic disabled", func() { Conf.m.Lock(); Conf.OCR.Auto = false; Conf.m.Unlock() }, ""},
		{"model changed", func() { Conf.m.Lock(); Conf.OCR.AIModelID = "other"; Conf.m.Unlock() }, ""},
		{"AI model disabled", func() { Conf.AI.Providers[0].Models[0].Enabled = false }, ""},
		{"manually edited", func() { SetOCRAssetText(path, "manual text") }, "manual text"},
	} {
		t.Run(test.name, func(t *testing.T) {
			util.RemoveAssetText(path)
			value := conf.OCR{Provider: "ai", Model: "tiny", AIModelID: "vision", Auto: true}
			Conf.OCR = &value
			Conf.AI.Providers[0].Models[0].Enabled = true
			beforeResponse = test.change
			_, _, err := ocrAsset(context.Background(), path, value, true)
			if !errors.Is(err, context.Canceled) || util.GetAssetText(path) != test.want {
				t.Fatalf("in-flight automatic response replaced text: %v, %q", err, util.GetAssetText(path))
			}
		})
	}
	beforeResponse = nil
	Conf.AI.Providers[0].Models[0].Enabled = true
	Conf.OCR = &conf.OCR{Provider: "ai", Model: "tiny", AIModelID: "vision", Auto: true}
	util.RemoveAssetText(path)
	const extra = "assets/automatic-20261005000000-abcdefg.png"
	extraFile, err := os.Create(filepath.Join(util.DataDir, filepath.FromSlash(extra)))
	if err != nil {
		t.Fatal(err)
	}
	err = png.Encode(extraFile, image.NewRGBA(image.Rect(0, 0, 16, 16)))
	extraFile.Close()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { util.RemoveAssetText(extra) })
	const unsupported = "assets/unsupported-20261005000000-abcdefg.svg"
	if err = os.WriteFile(filepath.Join(util.DataDir, filepath.FromSlash(unsupported)), []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 0600); err != nil {
		t.Fatal(err)
	}
	cache.LoadAssets()
	previousCalls := calls
	autoOCRAssets()
	if calls != previousCalls+1 || util.ExistsAssetText(path) == util.ExistsAssetText(extra) {
		t.Fatal("AI automatic batch must recognize only one unprocessed image")
	}
	autoOCRAssets()
	if calls != previousCalls+2 || !util.ExistsAssetText(path) || !util.ExistsAssetText(extra) {
		t.Fatal("AI automatic OCR did not process remaining image")
	}
	autoOCRAssets()
	if calls != previousCalls+2 {
		t.Fatal("AI automatic OCR reran saved results")
	}
	util.RemoveAssetText(extra)
	Conf.OCR.Auto = false
	autoOCRAssets()
	Conf.OCR.Auto, Conf.OCR.AIModelID = true, "missing"
	autoOCRAssets()
	if calls != previousCalls+2 {
		t.Fatal("disabled automatic OCR or unavailable model reached provider")
	}
	if err = os.Remove(filepath.Join(util.DataDir, filepath.FromSlash(extra))); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(filepath.Join(util.DataDir, filepath.FromSlash(unsupported))); err != nil {
		t.Fatal(err)
	}
	cache.LoadAssets()
	SetOCRAssetText(path, "editedocrkeyword")
	sql.FlushQueue()
}
