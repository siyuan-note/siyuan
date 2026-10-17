package api

import (
	"bytes"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractOCRClearDuringDownload(t *testing.T) {
	const child = "SIYUAN_TEST_OCR_CLEAR_DOWNLOAD"
	if os.Getenv(child) != "1" {
		command := exec.Command(os.Args[0], "-test.run=^TestAPIContractOCRClearDuringDownload$", "-test.timeout=30s", "-test.v")
		command.Env = append(os.Environ(), child+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("OCR download subprocess: %v\n%s", err, output)
		}
		return
	}
	var imageData bytes.Buffer
	if err := png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 16, 16))); err != nil {
		t.Fatal(err)
	}
	setupDeferredAssetAPIWorkspace(t, false, imageData.Bytes())
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, aiOCRSuccess)
	}))
	defer server.Close()
	model.Conf.AI.Store(conf.NewAI())
	model.Conf.AI.Load().Providers = []*conf.Provider{{ID: "provider", Enabled: true, APIKey: "test", BaseURL: server.URL + "/v1",
		Models: []*conf.Model{{ID: "vision", Enabled: true, Name: "vision-test"}}}}
	model.Conf.OCR.Store(&conf.OCR{Provider: "ai", Model: "tiny", AIModelID: "vision"})
	engine := gin.New()
	engine.POST("/api/asset/ocr", ocr)
	engine.POST("/api/asset/setImageOCRText", setImageOCRText)
	engine.POST("/api/asset/getImageOCRText", getImageOCRText)
	const path = "assets/plain.bin"
	defer util.RemoveAssetText(path)
	cleared := false
	if err := eventbus.Subscribe(eventbus.EvtCloudBeforeDownloadChunks, func(_ map[string]any, _ int) {
		if cleared {
			return
		}
		cleared = true
		if _, err := os.Stat(filepath.Join(util.DataDir, filepath.FromSlash(path))); !os.IsNotExist(err) {
			t.Error("OCR download hook ran after the asset was materialized")
		}
		if code := requestOCRProvider(t, engine, "/api/asset/setImageOCRText", `{"path":"assets/plain.bin","text":""}`, nil); code != 0 {
			t.Errorf("clear during download failed: %d", code)
		}
	}); err != nil {
		t.Fatal(err)
	}
	if code := requestOCRProvider(t, engine, "/api/asset/ocr", `{"path":"assets/plain.bin"}`, nil); code != -1 || !cleared || calls != 1 {
		t.Fatalf("in-flight OCR was not canceled after clearing during download: code=%d cleared=%v calls=%d", code, cleared, calls)
	}
	var result apicontract.ImageOCRTextData
	if code := requestOCRProvider(t, engine, "/api/asset/getImageOCRText", `{"path":"assets/plain.bin"}`, &result); code != 0 ||
		!util.ExistsAssetText(path) || result.Text != "" || result.Failed {
		t.Fatalf("downloaded OCR restored cleared text or failure: code=%d result=%+v", code, result)
	}
	if code := requestOCRProvider(t, engine, "/api/asset/ocr", `{"path":"assets/plain.bin"}`, nil); code != 0 || util.GetAssetText(path) == "" {
		t.Fatalf("new manual OCR did not restore text: code=%d text=%q", code, util.GetAssetText(path))
	}
}
