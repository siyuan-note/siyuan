//go:build fts5

package model

import (
	"context"
	"errors"
	"fmt"
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
	previousAI := Conf.AI.Load()
	previousOCR := Conf.GetOCR()
	defer func() {
		{
			confSectionValue0, confSectionValue1 := previousAI, &previousOCR
			Conf.AI.Store(confSectionValue0)
			Conf.OCR.Store(confSectionValue1)
		}
	}()
	calls := 0
	providerFailure := false
	var beforeResponse func()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if beforeResponse != nil {
			beforeResponse()
		}
		w.Header().Set("Content-Type", "application/json")
		if providerFailure {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"error":{"message":"unsupported reasoning effort","type":"invalid_request_error"}}`)
			return
		}
		_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":"aiocrkeyword\nsecond  column"}}]}`)
	}))
	defer server.Close()
	Conf.AI.Store(conf.NewAI())
	Conf.AI.Load().Agent.ModelID = "vision"
	Conf.AI.Load().Providers = []*conf.Provider{{ID: "provider", Enabled: true, APIKey: "test", BaseURL: server.URL + "/v1",
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
	Conf.OCR.Store(&conf.OCR{Provider: "ai", Model: "tiny", AIModelID: "vision", Auto: true})
	for _, test := range []struct {
		name   string
		change func()
		want   string
	}{
		{"automatic disabled", func() { Conf.m.Lock(); Conf.OCR.Load().Auto = false; Conf.m.Unlock() }, ""},
		{"model changed", func() { Conf.m.Lock(); Conf.OCR.Load().AIModelID = "other"; Conf.m.Unlock() }, ""},
		{"reasoning changed", func() { Conf.m.Lock(); Conf.OCR.Load().ReasoningEffort = "none"; Conf.m.Unlock() }, ""},
		{"AI model disabled", func() { Conf.AI.Load().Providers[0].Models[0].Enabled = false }, ""},
		{"manually edited", func() { SetOCRAssetText(path, "manual text") }, "manual text"},
		{"manually cleared", func() { SetOCRAssetText(path, "") }, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			util.RemoveAssetText(path)
			value := conf.OCR{Provider: "ai", Model: "tiny", AIModelID: "vision", Auto: true}
			Conf.OCR.Store(&value)
			Conf.AI.Load().Providers[0].Models[0].Enabled = true
			beforeResponse = test.change
			_, _, err := ocrAsset(context.Background(), path, value, true)
			if !errors.Is(err, context.Canceled) || util.GetAssetText(path) != test.want {
				t.Fatalf("in-flight automatic response replaced text: %v, %q", err, util.GetAssetText(path))
			}
			if HasOCRFailure(path) {
				t.Fatal("canceled automatic recognition was reported as failure")
			}
		})
	}
	for _, automatic := range []bool{false, true} {
		for _, failed := range []bool{false, true} {
			t.Run(fmt.Sprintf("AI clear automatic=%v failed=%v", automatic, failed), func(t *testing.T) {
				util.RemoveAssetText(path)
				value := conf.OCR{Provider: "ai", Model: "tiny", AIModelID: "vision", Auto: true}
				Conf.OCR.Store(&value)
				providerFailure = failed
				beforeResponse = func() { SetOCRAssetText(path+"?width=200#cleared", "") }
				_, err := aiOCRAsset(context.Background(), path+"?width=100#recognizing", value, automatic)
				beforeResponse = nil
				if err == nil || !failed && !errors.Is(err, context.Canceled) {
					t.Fatalf("unexpected invalidated AI request result: %v", err)
				}
				if !util.ExistsAssetText(path) || util.GetAssetText(path) != "" || HasOCRFailure(path) {
					t.Fatalf("in-flight AI response changed cleared text or status: %q, %v", util.GetAssetText(path), HasOCRFailure(path))
				}
				ocrRequests.Lock()
				active := len(ocrRequests.active)
				ocrRequests.Unlock()
				if active != 0 {
					t.Fatal("completed AI OCR retained request state")
				}
				providerFailure = false
				if _, err = AIOCRAsset(context.Background(), path); err != nil || !strings.Contains(util.GetAssetText(path), "aiocrkeyword") {
					t.Fatalf("manual AI recognition after clearing did not restore text: %v, %q", err, util.GetAssetText(path))
				}
			})
		}
	}
	beforeResponse = nil
	Conf.AI.Load().Providers[0].Models[0].Enabled = true
	Conf.OCR.Store(&conf.OCR{Provider: "ai", Model: "tiny", AIModelID: "vision", Auto: true})
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
	Conf.OCR.Load().Auto = false
	autoOCRAssets()
	Conf.OCR.Load().Auto, Conf.OCR.Load().AIModelID = true, "missing"
	autoOCRAssets()
	if calls != previousCalls+2 {
		t.Fatal("disabled automatic OCR or unavailable model reached provider")
	}
	Conf.OCR.Load().AIModelID = "vision"
	providerFailure = true
	autoOCRAssets()
	if !HasOCRFailure(extra) {
		t.Fatal("automatic AI provider failure was not recorded")
	}
	providerFailure = false
	autoOCRAssets()
	if calls != previousCalls+3 || util.ExistsAssetText(extra) {
		t.Fatal("failed automatic OCR was not held for retry")
	}
	Conf.OCR.Load().ReasoningEffort = "none"
	autoOCRAssets()
	if calls != previousCalls+4 || !util.ExistsAssetText(extra) {
		t.Fatal("changed reasoning effort inherited the previous retry delay")
	}
	if HasOCRFailure(extra) {
		t.Fatal("successful automatic AI recognition did not clear the failure")
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
