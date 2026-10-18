package api

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/livephoto"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractLivePhotoPreview(t *testing.T) {
	assets := setupAssetContractWorkspace(t)
	model.Conf.FileTree.Store(conf.NewFileTree())
	previous := model.LivePhotoPreviews
	cache := t.TempDir()
	model.LivePhotoPreviews = livephoto.NewManager(func() string { return cache })
	t.Cleanup(func() { model.LivePhotoPreviews.Clear(""); model.LivePhotoPreviews = previous })
	source := testutil.LivePhotoMOV(t)
	path := filepath.Join(assets, "live.mov")
	if err := os.WriteFile(path, source, 0600); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(boxLeaseMiddleware, func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) })
	engine.POST("/api/asset/startLivePhotoPreview", startLivePhotoPreview)
	engine.POST("/api/asset/getLivePhotoPreview", getLivePhotoPreview)
	engine.POST("/api/asset/getLivePhotoFrame", getLivePhotoFrame)
	engine.POST("/api/asset/cancelLivePhotoPreview", cancelLivePhotoPreview)
	call := func(endpoint string, request any) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(request)
		recorder := httptest.NewRecorder()
		url := "/api/asset/" + endpoint
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", url, bytes.NewReader(data)))
		requireAPIContract(t, "POST", url, recorder)
		return recorder
	}
	started := call("startLivePhotoPreview", apicontract.StartLivePhotoPreviewRequest{Path: "assets/live.mov", ClientEncode: true})
	var response struct {
		Code int
		Data apicontract.LivePhotoPreviewSession
	}
	if err := json.Unmarshal(started.Body.Bytes(), &response); err != nil || response.Code != 0 || response.Data.ID == "" || response.Data.Encode {
		t.Fatalf("start: %s, %v", started.Body, err)
	}
	preview := call("getLivePhotoPreview", apicontract.LivePhotoPreviewRequest{ID: response.Data.ID})
	if preview.Code != 200 || preview.Header().Get("Content-Type") != "video/mp4" || preview.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("preview: %d %v", preview.Code, preview.Header())
	}
	if _, err := livephoto.Open(preview.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
	frame := call("getLivePhotoFrame", apicontract.LivePhotoFrameRequest{ID: response.Data.ID, Index: -1})
	if frame.Code != 422 {
		t.Fatal("accepted invalid frame index")
	}
	call("cancelLivePhotoPreview", apicontract.LivePhotoPreviewRequest{ID: response.Data.ID})
	if expired := call("getLivePhotoPreview", apicontract.LivePhotoPreviewRequest{ID: response.Data.ID}); expired.Code != 422 {
		t.Fatal("expired session remained readable")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(after, source) {
		t.Fatal("source movie changed")
	}
	for _, invalid := range []string{"../live.mov", "https://example.com/live.mov", "assets/missing.mov"} {
		result := call("startLivePhotoPreview", apicontract.StartLivePhotoPreviewRequest{Path: invalid})
		var failure struct{ Code int }
		if err := json.Unmarshal(result.Body.Bytes(), &failure); err != nil || failure.Code == 0 {
			t.Fatalf("accepted invalid path %q: %s", invalid, result.Body)
		}
	}
}
