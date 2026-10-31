// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"bytes"
	"html/template"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAuthPageActionLayout(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "app", "stage", "auth.html"))
	if err != nil {
		t.Fatal(err)
	}
	pageTemplate, err := template.New("auth").Parse(string(data))
	if err != nil {
		t.Fatal(err)
	}
	render := func(accessAuthCodeEnabled bool) string {
		var output bytes.Buffer
		if err = pageTemplate.Execute(&output, map[string]any{
			"accessAuthCodeEnabled": accessAuthCodeEnabled,
			"oidcEnabled":           true,
		}); err != nil {
			t.Fatal(err)
		}
		return output.String()
	}

	oidcOnlyPage := render(false)
	if !strings.Contains(oidcOnlyPage, `id="oidcLogin"`) ||
		!strings.Contains(oidcOnlyPage, `class="auth-actions"`) {
		t.Fatal("OIDC-only authentication page omits the OIDC action layout")
	}
	if strings.Index(oidcOnlyPage, `id="rememberMe"`) < strings.Index(oidcOnlyPage, `id="oidcLogin"`) {
		t.Fatal("OIDC-only authentication page renders remember me before the login action")
	}
	lockScreenPage := render(true)
	if !strings.Contains(lockScreenPage, `<form id="authForm"`) ||
		!strings.Contains(lockScreenPage, `autocomplete="current-password"`) ||
		!strings.Contains(lockScreenPage, `id="authSubmit" type="submit"`) {
		t.Fatal("authentication page omits the sign-in form markup required by password managers")
	}
	rememberMeIndex := strings.Index(lockScreenPage, `id="rememberMe"`)
	if rememberMeIndex < strings.Index(lockScreenPage, `id="authSubmit"`) ||
		rememberMeIndex < strings.Index(lockScreenPage, `id="oidcLogin"`) {
		t.Fatal("combined authentication page renders remember me before a login action")
	}
}

// 授权页在登录前可访问，不论客户端标识如何都不得返回工作空间路径。
func TestAuthPageOmitsWorkspaceDir(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf, previousWorkingDir, previousDir := model.Conf, util.WorkingDir, util.WorkspaceDir
	t.Cleanup(func() { model.Conf, util.WorkingDir, util.WorkspaceDir = previousConf, previousWorkingDir, previousDir })
	model.Conf = model.NewAppConf()
	model.Conf.Appearance.Store(conf.NewAppearance())
	model.Conf.Keymap.Store(conf.NormalizeKeymap(nil))
	model.Conf.AccessAuthCode = "lock-screen-password"
	util.WorkingDir = filepath.Join("..", "..", "app")
	util.WorkspaceDir = filepath.Join(t.TempDir(), "alice-private-workspace")

	engine := gin.New()
	serveCheckAuth(engine)
	for _, userAgent := range []string{"SiYuan/3.8.10 https://b3log.org/siyuan Electron Chrome/140", "SiYuan/3.8.10 Android", "Mozilla/5.0"} {
		r := httptest.NewRequest(http.MethodGet, "http://192.0.2.10:6806/check-auth", nil)
		r.RemoteAddr = "192.0.2.20:1234"
		r.Header.Set("User-Agent", userAgent)
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, r)
		body := w.Body.String()
		if w.Code != http.StatusOK || !strings.Contains(body, `ipcRenderer.invoke("siyuan-init"`) {
			t.Fatalf("auth page was not rendered for %q: %d", userAgent, w.Code)
		}
		if strings.Contains(body, "alice-private-workspace") {
			t.Fatalf("auth page exposes the workspace path to %q", userAgent)
		}
	}
}
