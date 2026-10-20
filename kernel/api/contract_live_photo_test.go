package api

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/livephoto"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractLivePhotoPreviewSymlinkBoundary(t *testing.T) {
	assets := setupAssetContractWorkspace(t)
	model.Conf.FileTree.Store(conf.NewFileTree())
	const boxID = "20261019000000-box0002"
	box := &model.Box{ID: boxID}
	if err := box.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "source.mov")
	if err := os.WriteFile(outside, testutil.LivePhotoMOV(t), 0600); err != nil {
		t.Fatal(err)
	}
	documentAssets := filepath.Join(util.DataDir, boxID, "20261019000001-doc0002", "assets")
	if err := os.MkdirAll(documentAssets, 0755); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{assets, documentAssets} {
		if err := os.Symlink(outside, filepath.Join(dir, "outside.mov")); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
	}
	engine := gin.New()
	engine.Use(boxLeaseMiddleware, func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) })
	engine.POST("/api/asset/startLivePhotoPreview", startLivePhotoPreview)
	for _, location := range []string{"global", "document"} {
		t.Run(location, func(t *testing.T) {
			if location == "document" {
				if err := os.Remove(filepath.Join(assets, "outside.mov")); err != nil {
					t.Fatal(err)
				}
				if _, err := model.GetAssetAbsPathInBox("assets/outside.mov", ""); err != nil {
					t.Fatalf("fixture is not discoverable: %v", err)
				}
			}
			data, _ := json.Marshal(apicontract.StartLivePhotoPreviewRequest{Path: "assets/outside.mov"})
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/startLivePhotoPreview", bytes.NewReader(data)))
			requireAPIContract(t, "POST", "/api/asset/startLivePhotoPreview", recorder)
			var response struct {
				Code int
				Data apicontract.LivePhotoPreviewSession
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code >= 0 || response.Data.ID != "" {
				t.Fatalf("outside asset admitted: %s, %v", recorder.Body, err)
			}
		})
	}
}

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
	for _, filename := range []string{"夏天.mov", "Summer day.mov", "plus+clip.mov", "literal%20.mov", "hash#clip.mov"} {
		for _, boxID := range []string{"", "20261019000000-box0001"} {
			t.Run(filename+"/"+boxID, func(t *testing.T) {
				assetDir := assets
				if boxID != "" {
					assetDir = filepath.Join(util.DataDir, boxID, "assets")
					box := &model.Box{ID: boxID}
					if err := box.SaveConf(conf.NewBoxConf()); err != nil {
						t.Fatal(err)
					}
				}
				if err := os.MkdirAll(assetDir, 0700); err != nil {
					t.Fatal(err)
				}
				assetPath := filepath.Join(assetDir, filename)
				if err := os.WriteFile(assetPath, source, 0600); err != nil {
					t.Fatal(err)
				}
				requestPath := "assets/" + url.PathEscape(filename)
				if boxID != "" {
					requestPath += "?box=" + boxID + "&note=Summer+day%26box%3Dother"
				}
				started := call("startLivePhotoPreview", apicontract.StartLivePhotoPreviewRequest{Path: requestPath})
				var response struct {
					Code int
					Data apicontract.LivePhotoPreviewSession
				}
				if err := json.Unmarshal(started.Body.Bytes(), &response); err != nil || response.Code != 0 || response.Data.ID == "" {
					t.Fatalf("encoded asset: %s, %v", started.Body, err)
				}
				origin, err := model.LivePhotoPreviews.Origin(response.Data.ID)
				if err != nil || origin != assetPath {
					t.Fatalf("resolved asset: %s, want %s, %v", origin, assetPath, err)
				}
				preview := call("getLivePhotoPreview", apicontract.LivePhotoPreviewRequest{ID: response.Data.ID})
				if preview.Code != 200 {
					t.Fatalf("encoded asset preview: %s", preview.Body)
				}
				if _, err := livephoto.Open(preview.Body.Bytes()); err != nil {
					t.Fatal(err)
				}
				call("cancelLivePhotoPreview", apicontract.LivePhotoPreviewRequest{ID: response.Data.ID})
				after, err := os.ReadFile(assetPath)
				if err != nil || !bytes.Equal(after, source) {
					t.Fatal("renamed original movie changed")
				}
			})
		}
	}
	for _, invalid := range []string{"../live.mov", "https://example.com/live.mov", "assets/missing.mov",
		"assets/%GG.mov", "assets/%2e%2e/private.mov", "assets/live.mov?box=%GG", "assets/live.mov?box=invalid"} {
		result := call("startLivePhotoPreview", apicontract.StartLivePhotoPreviewRequest{Path: invalid})
		var failure struct{ Code int }
		if err := json.Unmarshal(result.Body.Bytes(), &failure); err != nil || failure.Code == 0 {
			t.Fatalf("accepted invalid path %q: %s", invalid, result.Body)
		}
	}
}
