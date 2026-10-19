package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/livephoto"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractLivePhotoBrowserSample(t *testing.T) {
	samplePath, electron, script := os.Getenv("SIYUAN_LIVE_PHOTO_SAMPLE"), os.Getenv("SIYUAN_LIVE_PHOTO_ELECTRON"), os.Getenv("SIYUAN_LIVE_PHOTO_BROWSER_SCRIPT")
	if samplePath == "" || electron == "" || script == "" {
		t.Skip("optional MOV and isolated browser integration fixture")
	}
	assets := setupAssetContractWorkspace(t)
	model.Conf.FileTree.Store(conf.NewFileTree())
	source, err := os.ReadFile(samplePath)
	if err != nil {
		t.Fatal(err)
	}
	assetPath := filepath.Join(assets, "live.mov")
	if err := os.WriteFile(assetPath, source, 0600); err != nil {
		t.Fatal(err)
	}
	cache := t.TempDir()
	previous := model.LivePhotoPreviews
	model.LivePhotoPreviews = livephoto.NewManager(func() string { return cache })
	t.Cleanup(func() { model.LivePhotoPreviews.Clear(""); model.LivePhotoPreviews = previous })
	var frames, encodes atomic.Int32
	engine := gin.New()
	engine.Use(boxLeaseMiddleware, func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) })
	engine.GET("/stage/build/app/", func(c *gin.Context) {
		c.Data(200, "text/html; charset=utf-8", []byte("<!doctype html><title>Isolated Live Photo verification</title>"))
	})
	engine.GET("/assets/live.mov", func(c *gin.Context) {
		http.ServeContent(c.Writer, c.Request, "live.mov", time.Time{}, bytes.NewReader(source))
	})
	engine.POST("/api/asset/startLivePhotoPreview", startLivePhotoPreview)
	engine.POST("/api/asset/getLivePhotoFrame", func(c *gin.Context) { frames.Add(1); getLivePhotoFrame(c) })
	engine.POST("/api/asset/finishLivePhotoPreview", func(c *gin.Context) { encodes.Add(1); finishLivePhotoPreview(c) })
	engine.POST("/api/asset/getLivePhotoPreview", getLivePhotoPreview)
	engine.POST("/api/asset/cancelLivePhotoPreview", cancelLivePhotoPreview)
	server := httptest.NewServer(engine)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, electron, script)
	for _, value := range os.Environ() {
		if !strings.HasPrefix(strings.ToUpper(value), "ELECTRON_RUN_AS_NODE=") {
			command.Env = append(command.Env, value)
		}
	}
	reportPath := filepath.Join(t.TempDir(), "report.json")
	if requested := os.Getenv("SIYUAN_LIVE_PHOTO_REPORT"); requested != "" {
		reportPath = requested
	}
	command.Env = append(command.Env, "SIYUAN_LIVE_PHOTO_ORIGIN="+server.URL, "SIYUAN_LIVE_PHOTO_PROFILE="+t.TempDir(), "SIYUAN_LIVE_PHOTO_REPORT="+reportPath)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("isolated browser: %v\n%s", err, output)
	}
	var report struct {
		DecodedFrames int
		AudioPeak     int
		Cleaned       bool
		FirstMs       float64
		WarmMs        float64
	}
	data, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatal(err)
	}
	if report.DecodedFrames < 53 || report.AudioPeak <= 0 || !report.Cleaned || frames.Load() != 53 || encodes.Load() != 1 {
		t.Fatalf("invalid playback: %s; frames=%d encodes=%d", data, frames.Load(), encodes.Load())
	}
	after, err := os.ReadFile(assetPath)
	if err != nil || !bytes.Equal(source, after) {
		t.Fatal("source changed")
	}
	t.Logf("product frontend and API: %d frames, audio signal %d, first %.0f ms, warm %.0f ms", report.DecodedFrames, report.AudioPeak, report.FirstMs, report.WarmMs)
}
