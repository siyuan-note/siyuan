// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSystemWallpaper(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf, previousDir, previousReadonly := model.Conf, util.ConfDir, util.ReadOnly
	working, appearance, themes, icons := util.WorkingDir, util.AppearancePath, util.ThemesPath, util.IconsPath
	dataDir, repoDir, mode, lang := util.DataDir, util.RepoDir, util.Mode, util.Lang
	root := t.TempDir()
	model.Conf, util.ConfDir, util.ReadOnly = model.NewAppConf(), filepath.Join(root, "conf"), false
	util.WorkingDir, util.AppearancePath = filepath.Join(root, "working"), filepath.Join(util.ConfDir, "appearance")
	util.DataDir, util.RepoDir = filepath.Join(root, "data"), filepath.Join(root, "repo")
	util.ThemesPath, util.IconsPath = filepath.Join(util.DataDir, "themes"), filepath.Join(util.DataDir, "icons")
	util.Mode = "prod"
	if err := os.MkdirAll(util.ConfDir, 0700); err != nil {
		t.Fatal(err)
	}
	write := func(path, content string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"daylight", "midnight"} {
		base := filepath.Join(util.WorkingDir, "appearance", "themes", name)
		write(filepath.Join(base, "theme.json"), `{"name":"`+name+`","version":"1.0.0","modes":["light","dark"]}`)
		write(filepath.Join(base, "theme.css"), ":root {}")
	}
	base := filepath.Join(util.WorkingDir, "appearance", "icons", "litheness")
	write(filepath.Join(base, "icon.json"), `{"name":"litheness","version":"1.0.0"}`)
	write(filepath.Join(base, "icon.js"), "// icon")
	write(filepath.Join(util.WorkingDir, "appearance", "emojis", "conf.json"), "[]")
	model.Conf.Appearance.Store(conf.NewAppearance())
	model.Conf.Api.Store(&conf.API{Token: "wallpaper-test-token"})
	model.Conf.AccessAuthCode = "wallpaper-password"
	t.Cleanup(func() {
		model.CloseWatchThemes()
		model.Conf, util.ConfDir, util.ReadOnly = previousConf, previousDir, previousReadonly
		util.WorkingDir, util.AppearancePath, util.ThemesPath, util.IconsPath = working, appearance, themes, icons
		util.DataDir, util.RepoDir, util.Mode, util.Lang = dataDir, repoDir, mode, lang
		model.ApplyConfRuntime()
	})
	engine := gin.New()
	engine.Use(ginSessions.Sessions("wallpaper-contract", cookie.NewStore([]byte("wallpaper-contract-session-key"))))
	registerSystemRoutes(engine)
	engine.POST("/api/setting/patch", contractRouteHandlers(apicontract.PatchSetting, patchSetting)...)
	request := func(method, route string, data io.Reader, contentType string, authenticated bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, route, data)
		if authenticated {
			r.Header.Set("Authorization", "Token wallpaper-test-token")
		}
		r.Header.Set("Content-Type", contentType)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, r)
		if recorder.Code != http.StatusUnauthorized && recorder.Code != http.StatusForbidden {
			requireAPIContract(t, method, strings.Split(route, "?")[0], recorder)
		}
		return recorder
	}
	code := func(response *httptest.ResponseRecorder) int {
		t.Helper()
		var result struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatalf("invalid response: %s %v", response.Body.String(), err)
		}
		return result.Code
	}
	upload := func(data []byte, authenticated bool) *httptest.ResponseRecorder {
		t.Helper()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		file, err := writer.CreateFormFile("file", "../../private.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.Write(data); err != nil {
			t.Fatal(err)
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		return request("POST", "/api/system/uploadLockScreenWallpaper", &body, writer.FormDataContentType(), authenticated)
	}
	get := func() *httptest.ResponseRecorder {
		// 附加路径参数不会扩大公开文件范围。
		return request("GET", "/api/system/getLockScreenWallpaper?path=../conf.json&box=locked", nil, "", false)
	}
	patch := func(body string, expected bool) {
		t.Helper()
		response := request("POST", "/api/setting/patch", strings.NewReader(body), "application/json", true)
		if code(response) != 0 || model.Conf.LoadAppearance().LockScreenWallpaper != expected {
			t.Fatalf("patch failed: %s", response.Body.String())
		}
		persisted, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
		if err != nil {
			t.Fatal(err)
		}
		var config struct {
			Appearance struct {
				LockScreenWallpaper bool `json:"lockScreenWallpaper"`
			} `json:"appearance"`
		}
		if err = json.Unmarshal(persisted, &config); err != nil || config.Appearance.LockScreenWallpaper != expected {
			t.Fatalf("preference was not persisted: %v", err)
		}
	}
	if response := get(); response.Code != 404 || response.Body.Len() != 0 {
		t.Fatalf("default wallpaper is public: %d %s", response.Code, response.Body.String())
	}
	var imageData bytes.Buffer
	if err := png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 4, 3))); err != nil {
		t.Fatal(err)
	}
	if response := upload(imageData.Bytes(), false); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated upload accepted: %d", response.Code)
	}
	if response := upload(imageData.Bytes(), true); code(response) != 0 {
		t.Fatal(response.Body.String())
	}
	if response := get(); response.Code != 404 {
		t.Fatal("upload unexpectedly enabled preference")
	}
	patch(`{"appearance":{"lockScreenWallpaper":true}}`, true)
	first := get()
	if first.Code != 200 || !strings.HasPrefix(first.Header().Get("Content-Type"), "image/jpeg") ||
		first.Header().Get("Cache-Control") != "no-store" || first.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("invalid public image response: %d %v", first.Code, first.Header())
	}
	if response := upload([]byte("<svg onload='alert(1)'/>"), true); code(response) != -1 {
		t.Fatal("SVG accepted")
	}
	if response := get(); !bytes.Equal(response.Body.Bytes(), first.Body.Bytes()) {
		t.Fatal("invalid replacement changed wallpaper")
	}
	patch(`{"appearance":{"compactMode":true}}`, true)
	patch(`{"appearance":{"lockScreenWallpaper":null}}`, false)
	if get().Code != 404 {
		t.Fatal("reset preference left wallpaper public")
	}
	patch(`{"appearance":{"lockScreenWallpaper":true}}`, true)
	util.ReadOnly = true
	if response := upload(imageData.Bytes(), true); code(response) != -1 {
		t.Fatal("readonly upload accepted")
	}
	if response := request("POST", "/api/system/removeLockScreenWallpaper", nil, "", true); code(response) != -1 {
		t.Fatal("readonly removal accepted")
	}
	util.ReadOnly = false
	if response := request("POST", "/api/system/removeLockScreenWallpaper", nil, "", false); response.Code != 401 {
		t.Fatal("unauthenticated removal accepted")
	}
	patch(`{"appearance":{"lockScreenWallpaper":false}}`, false)
	for range 2 {
		if response := request("POST", "/api/system/removeLockScreenWallpaper", nil, "", true); code(response) != 0 {
			t.Fatal(response.Body.String())
		}
	}
	patch(`{"appearance":{"lockScreenWallpaper":true}}`, true)
	if get().Code != 404 {
		t.Fatal("missing image did not fall back")
	}
	if err := os.WriteFile(filepath.Join(util.ConfDir, "lockscreen", "wallpaper.jpg"), []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if get().Code != 404 {
		t.Fatal("corrupt image did not fall back")
	}
}

func TestAPIContractSystemWallpaperWriteRoles(t *testing.T) {
	previousConf := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = previousConf })
	for _, role := range []model.Role{model.RoleReader, model.RoleEditor} {
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
		registerSystemRoutes(engine)
		for _, route := range []string{"uploadLockScreenWallpaper", "removeLockScreenWallpaper"} {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/system/"+route, nil))
			if recorder.Code != 403 {
				t.Fatalf("%v allowed %s: %d", role, route, recorder.Code)
			}
		}
	}
}
