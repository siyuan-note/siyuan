// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSetSortRejectsInvalidRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/filetree/setSort", setSort)

	tests := []struct {
		name string
		body string
	}{
		{name: "empty", body: `{}`},
		{name: "null item", body: `{"docSorts":[null]}`},
		{name: "invalid ID", body: `{"docSorts":[{"id":"invalid","sort":0}]}`},
		{name: "missing sort", body: `{"docSorts":[{"id":"20260718000001-abcdefg"}]}`},
		{name: "fractional sort", body: `{"docSorts":[{"id":"20260718000001-abcdefg","sort":1.5}]}`},
		{name: "duplicate ID", body: `{"docSorts":[{"id":"20260718000001-abcdefg","sort":0},{"id":"20260718000001-abcdefg","sort":1}]}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/filetree/setSort", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int `json:"code"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if response.Code != -1 {
				t.Fatalf("invalid request returned code %d: %s", response.Code, recorder.Body.String())
			}
		})
	}
}

func TestReorderDocsRejectsInvalidRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/filetree/reorderDocs", reorderDocs)

	tests := []struct {
		name string
		body string
	}{
		{name: "empty", body: `{}`},
		{name: "invalid source ID", body: `{"sourceIDs":["invalid"],"targetID":"20260718000002-abcdefg","position":"before"}`},
		{name: "invalid target ID", body: `{"sourceIDs":["20260718000001-abcdefg"],"targetID":"invalid","position":"before"}`},
		{name: "invalid position", body: `{"sourceIDs":["20260718000001-abcdefg"],"targetID":"20260718000002-abcdefg","position":"middle"}`},
		{name: "target in sources", body: `{"sourceIDs":["20260718000002-abcdefg"],"targetID":"20260718000002-abcdefg","position":"after"}`},
		{name: "duplicate source", body: `{"sourceIDs":["20260718000001-abcdefg","20260718000001-abcdefg"],"targetID":"20260718000002-abcdefg","position":"after"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/filetree/reorderDocs", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int `json:"code"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); nil != err {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if -1 != response.Code {
				t.Fatalf("invalid request returned code %d: %s", response.Code, recorder.Body.String())
			}
		})
	}
}

func TestSetDocSortModeRejectsInvalidRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/filetree/setDocSortMode", setDocSortMode)

	tests := []struct {
		name string
		body string
	}{
		{name: "empty", body: `{}`},
		{name: "missing sort mode", body: `{"id":"20260718000001-abcdefg"}`},
		{name: "invalid ID", body: `{"id":"invalid","sortMode":0}`},
		{name: "fractional sort mode", body: `{"id":"20260718000001-abcdefg","sortMode":1.5}`},
		{name: "string sort mode", body: `{"id":"20260718000001-abcdefg","sortMode":"1"}`},
		{name: "notebook fallback mode", body: `{"id":"20260718000001-abcdefg","sortMode":15}`},
		{name: "internal unassigned mode", body: `{"id":"20260718000001-abcdefg","sortMode":256}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/filetree/setDocSortMode", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int `json:"code"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); nil != err {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if -1 != response.Code {
				t.Fatalf("invalid request returned code %d: %s", response.Code, recorder.Body.String())
			}
		})
	}
}

func TestAuthFilePublishAccessReturnsUniformFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		encryptedBoxID      = "20260731000000-encrypt"
		publicID            = "20260731000001-public0"
		missingID           = "20260731000002-missing"
		protectedID         = "20260731000003-protect"
		privateID           = "20260731000004-private"
		hiddenID            = "20260731000005-hidden0"
		forbiddenID         = "20260731000006-forbid0"
		forbiddenPasswordID = "20260731000007-forbid1"
		password            = "secret"
		passwordIncorrect   = "Password is incorrect"
	)

	oldDataDir := util.DataDir
	oldPublishAccess := model.PublishAccess{}
	if oldDataDir != "" {
		oldPublishAccess = model.GetPublishAccess()
	}
	oldConf := model.Conf
	oldLangs := util.Langs
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.Lang = "test"
	util.Langs = map[string]map[int]string{
		"test": {285: passwordIncorrect},
		"en":   {285: passwordIncorrect},
	}
	t.Cleanup(func() {
		defer func() { model.Conf = oldConf }()
		util.DataDir = oldDataDir
		util.Langs = oldLangs
		if oldDataDir != "" {
			if err := model.SetPublishAccess(oldPublishAccess); err != nil {
				t.Errorf("restore publish access failed: %v", err)
			}
		}
	})

	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	if err := (&model.Box{ID: encryptedBoxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: protectedID, Visible: true, Password: password},
		{ID: privateID, Visible: false, Password: password},
		{ID: hiddenID, Visible: false},
		{ID: forbiddenID, Visible: false, Disable: true},
		{ID: forbiddenPasswordID, Visible: false, Password: password, Disable: true},
	}); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.POST("/api/filetree/authFilePublishAccess", authFilePublishAccess)
	post := func(ip, ID, inputPassword string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(
			http.MethodPost,
			"/api/filetree/authFilePublishAccess",
			strings.NewReader(`{"id":"`+ID+`","password":"`+inputPassword+`"}`),
		)
		request.Header.Set("Content-Type", "application/json")
		request.RemoteAddr = ip + ":1234"
		engine.ServeHTTP(recorder, request)
		return recorder
	}

	failures := []struct {
		name     string
		ID       string
		password string
	}{
		{name: "public", ID: publicID},
		{name: "missing", ID: missingID},
		{name: "protected", ID: protectedID},
		{name: "private", ID: privateID},
		{name: "hidden", ID: hiddenID},
		{name: "forbidden", ID: forbiddenID},
		{name: "forbidden with password", ID: forbiddenPasswordID, password: password},
		{name: "encrypted notebook", ID: encryptedBoxID},
	}
	var failureBody string
	for i, test := range failures {
		t.Run(test.name, func(t *testing.T) {
			// 每个失败用例使用独立的来源 IP，避免触发限流影响失败响应一致性断言
			recorder := post(fmt.Sprintf("192.0.2.%d", 10+i), test.ID, test.password)
			if cookies := recorder.Header().Values("Set-Cookie"); len(cookies) != 0 {
				t.Fatalf("failed publish authentication set cookies: %v", cookies)
			}

			response := &struct {
				Code int    `json:"code"`
				Msg  string `json:"msg"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if response.Code != -1 || response.Msg != passwordIncorrect {
				t.Fatalf("unexpected failed publish authentication response: %s", recorder.Body.String())
			}
			if failureBody == "" {
				failureBody = recorder.Body.String()
			} else if recorder.Body.String() != failureBody {
				t.Fatalf("publish authentication failures differ:\ngot  %s\nwant %s", recorder.Body.String(), failureBody)
			}
		})
	}

	successes := []struct {
		name string
		ID   string
	}{
		{name: "protected", ID: protectedID},
		{name: "private", ID: privateID},
	}
	for i, test := range successes {
		t.Run(test.name+" success", func(t *testing.T) {
			recorder := post(fmt.Sprintf("192.0.2.%d", 100+i), test.ID, password)
			response := &struct {
				Code int    `json:"code"`
				Msg  string `json:"msg"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if response.Code != 0 || response.Msg != "" {
				t.Fatalf("unexpected successful publish authentication response: %s", recorder.Body.String())
			}
			cookies := recorder.Result().Cookies()
			if len(cookies) != 1 || cookies[0].Name != "publish-auth-"+test.ID {
				t.Fatalf("unexpected successful publish authentication cookies: %v", cookies)
			}
		})
	}
}

func TestAuthFilePublishAccessThrottlesBruteForce(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		protectedID    = "20260731000003-protect"
		password       = "secret"
		passwordWrong  = "wrong"
		passwordLocked = "Too many failed authentication attempts, please try again later"
	)

	oldDataDir := util.DataDir
	oldPublishAccess := model.PublishAccess{}
	if oldDataDir != "" {
		oldPublishAccess = model.GetPublishAccess()
	}
	oldConf := model.Conf
	oldLangs := util.Langs
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.Lang = "test"
	util.Langs = map[string]map[int]string{
		"test": {285: "Password is incorrect", 354: passwordLocked},
		"en":   {285: "Password is incorrect", 354: passwordLocked},
	}
	t.Cleanup(func() {
		defer func() { model.Conf = oldConf }()
		util.DataDir = oldDataDir
		util.Langs = oldLangs
		if oldDataDir != "" {
			if err := model.SetPublishAccess(oldPublishAccess); err != nil {
				t.Errorf("restore publish access failed: %v", err)
			}
		}
	})
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: protectedID, Visible: true, Password: password},
	}); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.POST("/api/filetree/authFilePublishAccess", authFilePublishAccess)
	post := func(password string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(
			http.MethodPost,
			"/api/filetree/authFilePublishAccess",
			strings.NewReader(`{"id":"`+protectedID+`","password":"`+password+`"}`),
		)
		request.Header.Set("Content-Type", "application/json")
		request.RemoteAddr = "192.0.2.200:1234"
		engine.ServeHTTP(recorder, request)
		return recorder
	}

	const attackerIP = "192.0.2.200"
	defer util.AuthThrottleReset(publishThrottleKey(attackerIP, protectedID))

	// 前 5 次失败为普通失败响应，第 6 次失败触发锁定但本次仍返回普通响应（与 util.AuthThrottleFail 语义一致）
	for i := range 6 {
		recorder := post(passwordWrong)
		if recorder.Code != http.StatusOK {
			t.Fatalf("attempt %d expected %d, got %d", i+1, http.StatusOK, recorder.Code)
		}
		response := &struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}{}
		if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
			t.Fatalf("unmarshal response failed: %v", err)
		}
		if response.Code != -1 || response.Msg != "Password is incorrect" {
			t.Fatalf("unexpected failed publish authentication response: %s", recorder.Body.String())
		}
	}

	// 超过阈值后返回 429 并携带 Retry-After，不再设置认证 Cookie
	recorder := post(passwordWrong)
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("throttled attempt expected %d, got %d", http.StatusTooManyRequests, recorder.Code)
	}
	if "" == recorder.Header().Get("Retry-After") {
		t.Fatal("throttled attempt should set Retry-After header")
	}
	response := &struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	if response.Code != -1 || response.Msg != passwordLocked {
		t.Fatalf("unexpected throttled publish authentication response: %s", recorder.Body.String())
	}
	if cookies := recorder.Result().Cookies(); 0 < len(cookies) {
		t.Fatalf("throttled publish authentication set cookies: %v", cookies)
	}

	// 锁定期间即使密码正确也会被拒绝
	recorder = post(password)
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("correct password during lock expected %d, got %d", http.StatusTooManyRequests, recorder.Code)
	}
	if cookies := recorder.Result().Cookies(); 0 < len(cookies) {
		t.Fatalf("correct password during lock set cookies: %v", cookies)
	}

	// 锁定解除后正确密码可认证成功
	util.AuthThrottleReset(publishThrottleKey(attackerIP, protectedID))
	recorder = post(password)
	if recorder.Code != http.StatusOK {
		t.Fatalf("post-lock success expected %d, got %d", http.StatusOK, recorder.Code)
	}
	response = &struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	if response.Code != 0 || response.Msg != "" {
		t.Fatalf("unexpected post-lock publish authentication response: %s", recorder.Body.String())
	}
	if cookies := recorder.Result().Cookies(); len(cookies) != 1 || cookies[0].Name != "publish-auth-"+protectedID {
		t.Fatalf("unexpected post-lock publish authentication cookies: %v", cookies)
	}
}

func TestAuthFilePublishAccessThrottleIsPerDocument(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		knownID       = "20260731000004-known01"
		targetID      = "20260731000005-target1"
		knownPassword = "known-secret"
		wrongPassword = "wrong"
	)

	oldDataDir := util.DataDir
	oldPublishAccess := model.PublishAccess{}
	if oldDataDir != "" {
		oldPublishAccess = model.GetPublishAccess()
	}
	oldConf := model.Conf
	oldLangs := util.Langs
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.Lang = "test"
	util.Langs = map[string]map[int]string{
		"test": {285: "Password is incorrect", 354: "Too many failed authentication attempts, please try again later"},
		"en":   {285: "Password is incorrect", 354: "Too many failed authentication attempts, please try again later"},
	}
	t.Cleanup(func() {
		defer func() { model.Conf = oldConf }()
		util.DataDir = oldDataDir
		util.Langs = oldLangs
		if oldDataDir != "" {
			if err := model.SetPublishAccess(oldPublishAccess); err != nil {
				t.Errorf("restore publish access failed: %v", err)
			}
		}
	})
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: knownID, Visible: true, Password: knownPassword},
		{ID: targetID, Visible: true, Password: "target-secret"},
	}); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.POST("/api/filetree/authFilePublishAccess", authFilePublishAccess)
	post := func(id, password string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/filetree/authFilePublishAccess",
			strings.NewReader(`{"id":"`+id+`","password":"`+password+`"}`))
		request.Header.Set("Content-Type", "application/json")
		request.RemoteAddr = "192.0.2.201:1234"
		engine.ServeHTTP(recorder, request)
		return recorder
	}
	code := func(recorder *httptest.ResponseRecorder) int {
		t.Helper()
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("unmarshal response failed: %v", err)
		}
		return response.Code
	}

	const attackerIP = "192.0.2.201"
	t.Cleanup(func() {
		util.AuthThrottleReset(publishThrottleKey(attackerIP, knownID))
		util.AuthThrottleReset(publishThrottleKey(attackerIP, targetID))
		util.AuthThrottleReset(publishThrottleKey(attackerIP, ""))
	})

	for range 5 {
		if recorder := post(targetID, wrongPassword); recorder.Code != http.StatusOK || code(recorder) != -1 {
			t.Fatalf("target failure expected ordinary denial, got %d %s", recorder.Code, recorder.Body.String())
		}
	}
	// 另一个文档认证成功不得清除目标文档的失败次数
	if recorder := post(knownID, knownPassword); recorder.Code != http.StatusOK || code(recorder) != 0 {
		t.Fatalf("known document authentication failed: %d %s", recorder.Code, recorder.Body.String())
	}
	// 第 6 次失败触发目标文档锁定，本次仍为普通失败响应
	if recorder := post(targetID, wrongPassword); recorder.Code != http.StatusOK || code(recorder) != -1 {
		t.Fatalf("sixth target failure expected ordinary denial, got %d %s", recorder.Code, recorder.Body.String())
	}
	// 锁定生效后返回 429，说明跨文档的成功认证没有重置计数
	if recorder := post(targetID, wrongPassword); recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("another document reset the throttle, got %d %s", recorder.Code, recorder.Body.String())
	}
	// 目标文档的锁定不影响其他文档认证
	if recorder := post(knownID, knownPassword); recorder.Code != http.StatusOK || code(recorder) != 0 {
		t.Fatalf("known document blocked by target throttle: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestPublishAccessConfigurationRejectsEncryptedNotebook(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		boxID = "20260726000000-encrypt"
		docID = "20260726000001-encrypt"
	)
	oldDataDir := util.DataDir
	oldPublishAccess := model.PublishAccess{}
	if oldDataDir != "" {
		oldPublishAccess = model.GetPublishAccess()
	}
	oldConf := model.Conf
	oldLangs := util.Langs
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.Lang = "test"
	util.Langs = map[string]map[int]string{
		"test": {313: "Encrypted notebooks do not support this operation"},
		"en":   {313: "Encrypted notebooks do not support this operation"},
	}
	if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		defer func() { model.Conf = oldConf }()
		util.DataDir = oldDataDir
		util.Langs = oldLangs
		if oldDataDir != "" {
			if err := model.SetPublishAccess(oldPublishAccess); err != nil {
				t.Errorf("restore publish access failed: %v", err)
			}
		}
	})

	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(util.DataDir, boxID, docID+".sy"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.POST("/api/filetree/setPublishAccess", setPublishAccess)
	engine.POST("/api/filetree/getPublishAccess", getPublishAccess)
	engine.POST("/api/filetree/authFilePublishAccess", authFilePublishAccess)
	tests := []struct {
		name string
		path string
		body string
	}{
		{
			name: "set",
			path: "/api/filetree/setPublishAccess",
			body: `{"id":"` + boxID + `","visible":true,"password":"","disable":false}`,
		},
		{
			name: "get",
			path: "/api/filetree/getPublishAccess",
			body: `{"ids":["` + boxID + `"]}`,
		},
		{
			name: "authenticate",
			path: "/api/filetree/authFilePublishAccess",
			body: `{"id":"` + boxID + `","password":""}`,
		},
		{
			name: "set locked document",
			path: "/api/filetree/setPublishAccess",
			body: `{"id":"` + docID + `","visible":true,"password":"","disable":false}`,
		},
		{
			name: "get locked document",
			path: "/api/filetree/getPublishAccess",
			body: `{"ids":["` + docID + `"]}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int `json:"code"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if response.Code != -1 {
				t.Fatalf("encrypted notebook publish access returned code %d: %s", response.Code, recorder.Body.String())
			}
		})
	}
	if len(model.GetPublishAccess()) != 0 {
		t.Fatal("encrypted notebook publish access should not be persisted")
	}
}

func TestPublishReaderCannotBrowseEncryptedNotebook(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		boxID = "20260726000000-encrypt"
		docID = "20260726000001-encrypt"
	)
	oldDataDir := util.DataDir
	oldConf := model.Conf
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.FileTree.Store(conf.NewFileTree())
	t.Cleanup(func() {
		util.DataDir = oldDataDir
		model.Conf = oldConf
	})

	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleReader)
		c.Next()
	})
	engine.POST("/api/filetree/listDocsByPath", listDocsByPath)
	engine.POST("/api/filetree/getDoc", getDoc)

	listRecorder := httptest.NewRecorder()
	listRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/filetree/listDocsByPath",
		strings.NewReader(`{"notebook":"`+boxID+`","path":"/"}`),
	)
	listRequest.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(listRecorder, listRequest)

	listResponse := &struct {
		Code int `json:"code"`
		Data struct {
			Files []any `json:"files"`
		} `json:"data"`
	}{}
	if err := json.Unmarshal(listRecorder.Body.Bytes(), listResponse); err != nil {
		t.Fatalf("unmarshal list response failed: %v", err)
	}
	if listResponse.Code != 0 || len(listResponse.Data.Files) != 0 {
		t.Fatalf("publish reader enumerated encrypted notebook: %s", listRecorder.Body.String())
	}

	docRecorder := httptest.NewRecorder()
	docRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/filetree/getDoc",
		strings.NewReader(`{"id":"`+docID+`","notebook":"`+boxID+`","includeDocInfo":true}`),
	)
	docRequest.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(docRecorder, docRequest)

	docResponse := &struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}{}
	if err := json.Unmarshal(docRecorder.Body.Bytes(), docResponse); err != nil {
		t.Fatalf("unmarshal document response failed: %v", err)
	}
	if docResponse.Code != 3 {
		t.Fatalf("publish reader accessed encrypted document: %s", docRecorder.Body.String())
	}
	if _, ok := docResponse.Data["docInfo"]; ok {
		t.Fatalf("publish reader received encrypted document info: %s", docRecorder.Body.String())
	}
}

func TestGetDocOptionallyReturnsEmbeddedDocInfo(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const boxID = "20260812000000-boxinfo"
	originalConf := model.Conf
	originalDataDir := util.DataDir
	originalBlockTreeDBPath := util.BlockTreeDBPath
	tempDir := t.TempDir()
	util.DataDir = filepath.Join(tempDir, "data")
	util.BlockTreeDBPath = filepath.Join(tempDir, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Sync.Store(conf.NewSync())

	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Embedded document info test"
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); nil != err {
		t.Fatalf("save test notebook config failed: %v", err)
	}
	treenode.InitBlockTree(true)
	tree := treenode.NewTree(boxID, "/20260812000001-docinfo.sy", "/Document", "Document")
	if _, err := filesys.WriteTree(tree); nil != err {
		t.Fatalf("write test tree failed: %v", err)
	}
	treenode.UpsertBlockTree(tree)
	t.Cleanup(func() {
		cache.RemoveTreeData(tree.ID)
		cache.RemoveDocIAL(tree.Path)
		treenode.CloseDatabase()
		model.Conf = originalConf
		util.DataDir = originalDataDir
		util.BlockTreeDBPath = originalBlockTreeDBPath
		if "" != originalBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	engine := gin.New()
	engine.POST("/api/filetree/getDoc", getDoc)
	request := func(body string) (data map[string]json.RawMessage) {
		t.Helper()
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/filetree/getDoc", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, req)
		response := &struct {
			Code int                        `json:"code"`
			Msg  string                     `json:"msg"`
			Data map[string]json.RawMessage `json:"data"`
		}{}
		if err := json.Unmarshal(recorder.Body.Bytes(), response); nil != err {
			t.Fatalf("unmarshal document response failed: %v", err)
		}
		if 0 != response.Code {
			t.Fatalf("get document failed with code %d and message %q: %s", response.Code, response.Msg, recorder.Body.String())
		}
		return response.Data
	}

	withoutInfo := request(`{"id":"` + tree.ID + `"}`)
	if _, ok := withoutInfo["docInfo"]; ok {
		t.Fatalf("document info should be absent by default: %s", withoutInfo["docInfo"])
	}

	withInfo := request(`{"id":"` + tree.Root.FirstChild.ID + `","includeDocInfo":true}`)
	infoJSON, ok := withInfo["docInfo"]
	if !ok {
		t.Fatal("requested embedded document info is absent")
	}
	info := &model.BlockInfo{}
	if err := json.Unmarshal(infoJSON, info); nil != err {
		t.Fatalf("unmarshal embedded document info failed: %v", err)
	}
	if info.ID != tree.ID || info.RootID != tree.ID || info.Name != "Document" {
		t.Fatalf("unexpected embedded document info: %#v", info)
	}
}

func TestFilterFileTreePublishAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Sync.Store(conf.NewSync())
	t.Cleanup(func() { model.Conf = previousConf })
	const (
		boxID             = "20260725000000-boxid01"
		otherBoxID        = "20260725000000-boxid02"
		publicID          = "20260725000001-public1"
		protectedID       = "20260725000002-protect"
		hiddenID          = "20260725000003-hidden1"
		privateID         = "20260725000004-private"
		forbiddenID       = "20260725000005-forbid1"
		missingID         = "20260725000006-missing"
		privatePassword   = "private-password"
		protectedPassword = "protected-password"
	)

	previousBlockTreeDBPath := util.BlockTreeDBPath
	previousDataDir := util.DataDir
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	previousPublishAccess := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: protectedID, Visible: true, Password: protectedPassword},
		{ID: hiddenID, Visible: false},
		{ID: privateID, Visible: false, Password: privatePassword},
		{ID: forbiddenID, Visible: false, Disable: true},
	}); err != nil {
		t.Fatalf("set publish access failed: %v", err)
	}
	t.Cleanup(func() {
		_ = model.SetPublishAccess(previousPublishAccess)
		treenode.CloseDatabase()
		util.BlockTreeDBPath = previousBlockTreeDBPath
		util.DataDir = previousDataDir
	})

	ids := []string{publicID, protectedID, hiddenID, privateID, forbiddenID}
	allIDs := append(slices.Clone(ids), missingID)
	boxConf := conf.NewBoxConf()
	boxConf.Closed, boxConf.Name = false, "Published"
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	otherBoxConf := conf.NewBoxConf()
	otherBoxConf.Closed, otherBoxConf.Name = false, "Another notebook"
	if err := (&model.Box{ID: otherBoxID}).SaveConf(otherBoxConf); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		owner := boxID
		if id == protectedID {
			owner = otherBoxID
		}
		treenode.IndexBlockTree(&parse.Tree{
			ID:    id,
			Box:   owner,
			Path:  "/" + id + ".sy",
			HPath: "/" + id,
			Root:  &ast.Node{ID: id, Type: ast.NodeDocument},
		})
	}

	paths := []string{
		"/" + publicID + ".sy",
		"/" + protectedID + ".sy",
		"/" + hiddenID + ".sy",
		"/" + privateID + ".sy",
		"/" + forbiddenID + ".sy",
		"/" + missingID + ".sy",
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	c.Set(model.RoleContextKey, model.RoleReader)

	engine := gin.New()
	engine.Use(func(ctx *gin.Context) { ctx.Set(model.RoleContextKey, model.GetGinContextRole(c)) })
	registerFiletreeRoutes(engine)
	requirePaths := func(expectedIDs ...string) {
		t.Helper()
		payload, err := json.Marshal(map[string][]string{"paths": paths})
		if err != nil {
			t.Fatal(err)
		}
		const endpoint = "/api/filetree/getHPathsByPaths"
		request := httptest.NewRequest(http.MethodPost, endpoint, strings.NewReader(string(payload)))
		for _, cookie := range c.Request.Cookies() {
			request.AddCookie(cookie)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, http.MethodPost, endpoint, recorder)
		var result struct {
			Code int      `json:"code"`
			Data []string `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != 0 {
			t.Fatalf("hierarchy paths request failed: %v, %s", err, recorder.Body.String())
		}
		expected := make([]string, 0, len(expectedIDs))
		for _, id := range expectedIDs {
			notebookName := "Published"
			if id == protectedID {
				notebookName = "Another notebook"
			}
			expected = append(expected, notebookName+"/"+id)
		}
		actual := slices.Clone(result.Data)
		slices.Sort(actual)
		slices.Sort(expected)
		if !slices.Equal(actual, expected) {
			t.Fatalf("unexpected hierarchy paths: %v, want %v", actual, expected)
		}
	}
	requirePaths(publicID, hiddenID)
	slices.Reverse(paths)
	requirePaths(publicID, hiddenID)
	expectedIDs := []string{publicID, protectedID}
	if filtered := filterFileTreeBlockIDsByPublishDiscoverability(c, allIDs, boxID); !slices.Equal(filtered, expectedIDs) {
		t.Fatalf("unexpected reader discoverable IDs: %v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + privateID,
		Value: model.PublishAuthCookieValue(privateID, privatePassword),
	})
	requirePaths(publicID, hiddenID, privateID)
	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: model.PublishAuthCookieValue(protectedID, protectedPassword),
	})
	requirePaths(publicID, protectedID, hiddenID, privateID)
	if filtered := filterFileTreeBlockIDsByPublishDiscoverability(c, allIDs, boxID); !slices.Equal(filtered, expectedIDs) {
		t.Fatalf("private documents should remain undiscoverable: %v", filtered)
	}

	c.Set(model.RoleContextKey, model.RoleAdministrator)
	requirePaths(ids...)
	if filtered := filterFileTreeBlockIDsByPublishDiscoverability(c, allIDs, boxID); !slices.Equal(filtered, allIDs) {
		t.Fatalf("administrator IDs should remain unchanged: %v", filtered)
	}
}

// TestListDocsByPathFiltersSubFileCountForPublishReader 验证发布读者看到的文档树
// 下级文档数只统计发布可见的文档，避免据此推断被排除文档的数量。
func TestListDocsByPathFiltersSubFileCountForPublishReader(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		boxID       = "20260726000000-boxid01"
		parentID    = "20260726000001-parent1"
		publicID    = "20260726000002-public1"
		hiddenID    = "20260726000003-hidden1"
		forbiddenID = "20260726000004-forbid1"
	)
	oldDataDir, oldConf := util.DataDir, model.Conf
	util.DataDir = t.TempDir()
	oldPublishAccess := model.GetPublishAccess()
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.FileTree.Store(conf.NewFileTree())
	const testLang = "filetree-subfile-count-test"
	installAPITestTimeLangs(t, testLang)
	model.Conf.Lang = testLang
	t.Cleanup(func() {
		if err := model.SetPublishAccess(oldPublishAccess); err != nil {
			t.Errorf("restore publish access failed: %v", err)
		}
		util.DataDir, model.Conf = oldDataDir, oldConf
	})
	if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
		t.Fatal(err)
	}

	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	boxDir := filepath.Join(util.DataDir, boxID)
	if err := os.MkdirAll(filepath.Join(boxDir, parentID), 0755); err != nil {
		t.Fatal(err)
	}
	// 文档属性必须非空，否则会被当作损坏数据移出笔记本
	writeDoc := func(dir, id string) {
		t.Helper()
		content := `{"Properties":{"id":"` + id + `","title":"` + id + `"}}`
		if err := os.WriteFile(filepath.Join(boxDir, dir, id+".sy"), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	writeDoc(".", parentID)
	writeDoc(parentID, publicID)
	writeDoc(parentID, hiddenID)
	writeDoc(parentID, forbiddenID)

	requestSubFileCount := func(role model.Role) int {
		t.Helper()

		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		engine.POST("/api/filetree/listDocsByPath", listDocsByPath)

		recorder := httptest.NewRecorder()
		httpRequest := httptest.NewRequest(
			http.MethodPost,
			"/api/filetree/listDocsByPath",
			strings.NewReader(`{"notebook":"`+boxID+`","path":"/"}`),
		)
		httpRequest.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, httpRequest)
		requireAPIContract(t, http.MethodPost, "/api/filetree/listDocsByPath", recorder)

		response := &struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
			Data struct {
				Files []*model.File `json:"files"`
			} `json:"data"`
		}{}
		if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
			t.Fatalf("unmarshal list response failed: %v", err)
		}
		if 0 != response.Code {
			t.Fatalf("list docs by path failed: %s", recorder.Body.String())
		}
		for _, file := range response.Data.Files {
			if file.ID == parentID {
				return file.SubFileCount
			}
		}
		t.Fatalf("parent document not found: %s", recorder.Body.String())
		return -1
	}

	if actual := requestSubFileCount(model.RoleAdministrator); 3 != actual {
		t.Fatalf("administrator subfile count = %d, want 3", actual)
	}

	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: hiddenID, Visible: false},
		{ID: forbiddenID, Visible: false, Disable: true},
	}); err != nil {
		t.Fatal(err)
	}
	if actual := requestSubFileCount(model.RoleReader); 1 != actual {
		t.Fatalf("reader subfile count = %d, want only the published one", actual)
	}
}

// TestListDocsByPathHidesPasswordMetadataForPublishReader 验证发布读者只能看到未设密码或已通过密码校验文档的
// 命名、别名、备注和书签，标题、图标与路径仍需保留用于树导航。
func TestListDocsByPathHidesPasswordMetadataForPublishReader(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		boxID             = "20261120000000-boxid01"
		publicID          = "20261120000001-public1"
		protectedID       = "20261120000002-protect"
		ancestorID        = "20261120000003-ancesto"
		childID           = "20261120000004-child01"
		protectedPassword = "protected-password"
	)
	oldDataDir, oldConf := util.DataDir, model.Conf
	util.DataDir = t.TempDir()
	oldPublishAccess := model.GetPublishAccess()
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.FileTree.Store(conf.NewFileTree())
	const testLang = "filetree-password-metadata-test"
	installAPITestTimeLangs(t, testLang)
	model.Conf.Lang = testLang
	t.Cleanup(func() {
		if err := model.SetPublishAccess(oldPublishAccess); err != nil {
			t.Errorf("restore publish access failed: %v", err)
		}
		util.DataDir, model.Conf = oldDataDir, oldConf
	})
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: protectedID, Visible: true, Password: protectedPassword},
		{ID: ancestorID, Visible: true, Password: protectedPassword},
	}); err != nil {
		t.Fatal(err)
	}

	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	boxDir := filepath.Join(util.DataDir, boxID)
	if err := os.MkdirAll(filepath.Join(boxDir, ancestorID), 0755); err != nil {
		t.Fatal(err)
	}
	writeDoc := func(dir, id string) {
		t.Helper()
		content := `{"Properties":{"id":"` + id + `","title":"` + id + `","name":"name-` + id +
			`","alias":"alias-` + id + `","memo":"memo-` + id + `","bookmark":"bookmark-` + id + `"}}`
		if err := os.WriteFile(filepath.Join(boxDir, dir, id+".sy"), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	writeDoc(".", publicID)
	writeDoc(".", protectedID)
	writeDoc(".", ancestorID)
	writeDoc(ancestorID, childID)

	requestFiles := func(role model.Role, cookie *http.Cookie, listPath string) map[string]*model.File {
		t.Helper()

		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		engine.POST("/api/filetree/listDocsByPath", listDocsByPath)

		recorder := httptest.NewRecorder()
		httpRequest := httptest.NewRequest(
			http.MethodPost,
			"/api/filetree/listDocsByPath",
			strings.NewReader(`{"notebook":"`+boxID+`","path":"`+listPath+`"}`),
		)
		httpRequest.Header.Set("Content-Type", "application/json")
		if nil != cookie {
			httpRequest.AddCookie(cookie)
		}
		engine.ServeHTTP(recorder, httpRequest)
		requireAPIContract(t, http.MethodPost, "/api/filetree/listDocsByPath", recorder)

		response := &struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
			Data struct {
				Files []*model.File `json:"files"`
			} `json:"data"`
		}{}
		if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
			t.Fatalf("unmarshal list response failed: %v", err)
		}
		if 0 != response.Code {
			t.Fatalf("list docs by path failed: %s", recorder.Body.String())
		}
		files := map[string]*model.File{}
		for _, file := range response.Data.Files {
			files[file.ID] = file
		}
		return files
	}
	requireMetadata := func(files map[string]*model.File, id, path string, wantHidden bool) {
		t.Helper()

		file := files[id]
		if nil == file {
			t.Fatalf("document [%s] not found in response", id)
		}
		if file.Name != id || file.Path != path {
			t.Fatalf("document [%s] title or path changed: %#v", id, file)
		}
		wantName1, wantAlias, wantMemo, wantBookmark := "name-"+id, "alias-"+id, "memo-"+id, "bookmark-"+id
		if wantHidden {
			wantName1, wantAlias, wantMemo, wantBookmark = "", "", "", ""
		}
		if file.Name1 != wantName1 || file.Alias != wantAlias || file.Memo != wantMemo || file.Bookmark != wantBookmark {
			t.Fatalf("document [%s] metadata = %#v, want name1 %q alias %q memo %q bookmark %q",
				id, file, wantName1, wantAlias, wantMemo, wantBookmark)
		}
	}

	publicPath, protectedPath := "/"+publicID+".sy", "/"+protectedID+".sy"
	ancestorPath, childPath := "/"+ancestorID+".sy", "/"+ancestorID+"/"+childID+".sy"
	readerFiles := requestFiles(model.RoleReader, nil, "/")
	requireMetadata(readerFiles, publicID, publicPath, false)
	requireMetadata(readerFiles, protectedID, protectedPath, true)
	requireMetadata(readerFiles, ancestorID, ancestorPath, true)
	requireMetadata(requestFiles(model.RoleReader, nil, ancestorPath), childID, childPath, true)

	readerFiles = requestFiles(model.RoleReader, &http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: model.PublishAuthCookieValue(protectedID, protectedPassword),
	}, "/")
	requireMetadata(readerFiles, protectedID, protectedPath, false)
	requireMetadata(readerFiles, ancestorID, ancestorPath, true)
	requireMetadata(requestFiles(model.RoleReader, nil, ancestorPath), childID, childPath, true)

	administratorFiles := requestFiles(model.RoleAdministrator, nil, "/")
	for id, p := range map[string]string{
		publicID: publicPath, protectedID: protectedPath, ancestorID: ancestorPath,
	} {
		requireMetadata(administratorFiles, id, p, false)
	}
	requireMetadata(requestFiles(model.RoleAdministrator, nil, ancestorPath), childID, childPath, false)
}

// TestListDocTreeRangeHidesPasswordMetadataForPublishReader 验证文档树范围接口同样不会向未通过密码校验的
// 发布读者返回命名、别名、备注和书签，标题与路径保持可用。
func TestListDocTreeRangeHidesPasswordMetadataForPublishReader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	box := documentPathAPIWorkspace(t)
	// 范围接口会查询加密笔记本，需要独立的语句数据库；前序用例可能已关闭全局数据库
	oldDBPath, oldQueueDir, oldReadOnly := util.DBPath, util.QueueDir, util.ReadOnly
	util.DBPath, util.QueueDir, util.ReadOnly = filepath.Join(util.TempDir, "siyuan.db"),
		filepath.Join(util.TempDir, "queue"), false
	t.Cleanup(func() { util.DBPath, util.QueueDir, util.ReadOnly = oldDBPath, oldQueueDir, oldReadOnly })
	sql.InitDatabase(true)
	t.Cleanup(sql.CloseDatabase)

	const (
		publicID          = "20261121000001-public1"
		protectedID       = "20261121000002-protect"
		protectedPassword = "protected-password"
	)
	oldLang := model.Conf.Lang
	installAPITestTimeLangs(t, "en")
	model.Conf.Lang = "en"
	t.Cleanup(func() { model.Conf.Lang = oldLang })
	oldPublishAccess := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: protectedID, Visible: true, Password: protectedPassword},
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := model.SetPublishAccess(oldPublishAccess); err != nil {
			t.Errorf("restore publish access failed: %v", err)
		}
	})

	writeTree := func(id string) {
		t.Helper()
		tree := treenode.NewTree(box, "/"+id+".sy", "/"+id, id)
		for key, value := range map[string]string{
			"name": "name-" + id, "alias": "alias-" + id, "memo": "memo-" + id, "bookmark": "bookmark-" + id,
		} {
			tree.Root.SetIALAttr(key, value)
		}
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	writeTree(publicID)
	writeTree(protectedID)

	requestFiles := func(role model.Role, cookie *http.Cookie) map[string]*model.File {
		t.Helper()

		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		engine.POST("/api/filetree/listDocTreeRange", boxLeaseMiddleware, listDocTreeRange)

		recorder := httptest.NewRecorder()
		httpRequest := httptest.NewRequest(
			http.MethodPost,
			"/api/filetree/listDocTreeRange",
			strings.NewReader(`{"notebook":"`+box+`","parentID":"","offset":0}`),
		)
		httpRequest.Header.Set("Content-Type", "application/json")
		if nil != cookie {
			httpRequest.AddCookie(cookie)
		}
		engine.ServeHTTP(recorder, httpRequest)
		requireAPIContract(t, http.MethodPost, "/api/filetree/listDocTreeRange", recorder)

		response := &struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
			Data struct {
				Files []*model.File `json:"files"`
			} `json:"data"`
		}{}
		if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
			t.Fatalf("unmarshal range response failed: %v", err)
		}
		if 0 != response.Code {
			t.Fatalf("list documents by range failed: %s", recorder.Body.String())
		}
		files := map[string]*model.File{}
		for _, file := range response.Data.Files {
			files[file.ID] = file
		}
		return files
	}
	requireMetadata := func(files map[string]*model.File, id string, wantHidden bool) {
		t.Helper()

		file := files[id]
		if nil == file {
			t.Fatalf("document [%s] not found in response", id)
		}
		if file.Name != id || file.Path != "/"+id+".sy" {
			t.Fatalf("document [%s] title or path changed: %#v", id, file)
		}
		wantName1, wantAlias, wantMemo, wantBookmark := "name-"+id, "alias-"+id, "memo-"+id, "bookmark-"+id
		if wantHidden {
			wantName1, wantAlias, wantMemo, wantBookmark = "", "", "", ""
		}
		if file.Name1 != wantName1 || file.Alias != wantAlias || file.Memo != wantMemo || file.Bookmark != wantBookmark {
			t.Fatalf("document [%s] metadata = %#v, want name1 %q alias %q memo %q bookmark %q",
				id, file, wantName1, wantAlias, wantMemo, wantBookmark)
		}
	}

	readerFiles := requestFiles(model.RoleReader, nil)
	requireMetadata(readerFiles, publicID, false)
	requireMetadata(readerFiles, protectedID, true)

	readerFiles = requestFiles(model.RoleReader, &http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: model.PublishAuthCookieValue(protectedID, protectedPassword),
	})
	requireMetadata(readerFiles, publicID, false)
	requireMetadata(readerFiles, protectedID, false)

	administratorFiles := requestFiles(model.RoleAdministrator, nil)
	requireMetadata(administratorFiles, publicID, false)
	requireMetadata(administratorFiles, protectedID, false)
}

// TestSearchDocsClearsNotebookFlashcardCountForPublishReader 验证空关键字闪卡搜索中合成的笔记本行不会把
// 受密码保护文档的闪卡计数暴露给发布读者，管理员仍得到全量计数。
func TestSearchDocsClearsNotebookFlashcardCountForPublishReader(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		boxID             = "20261122000000-boxid01"
		protectedID       = "20261122000001-protect"
		protectedPassword = "protected-password"
		builtinDeckID     = "20230218211946-2kw8jgx"
		cardID            = "20261122000002-card001"
	)
	oldConf, oldDataDir, oldDecks := model.Conf, util.DataDir, model.Decks
	oldBlockTreeDBPath := util.BlockTreeDBPath
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	oldPublishAccess := model.GetPublishAccess()
	treenode.InitBlockTree(true)
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Search.Store(conf.NewSearch())
	model.Conf.Flashcard.Store(conf.NewFlashcard())
	model.Decks = map[string]*riff.Deck{}
	t.Cleanup(func() {
		if err := model.SetPublishAccess(oldPublishAccess); err != nil {
			t.Errorf("restore publish access failed: %v", err)
		}
		treenode.CloseDatabase()
		model.Conf, util.DataDir, model.Decks = oldConf, oldDataDir, oldDecks
		util.BlockTreeDBPath = oldBlockTreeDBPath
	})
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: protectedID, Visible: true, Password: protectedPassword},
	}); err != nil {
		t.Fatal(err)
	}

	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Flashcard notebook", false
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	treenode.IndexBlockTree(&parse.Tree{
		ID:    protectedID,
		Box:   boxID,
		Path:  "/" + protectedID + ".sy",
		HPath: "/" + protectedID,
		Root:  &ast.Node{ID: protectedID, Type: ast.NodeDocument},
	})
	// 受密码保护文档中的闪卡仍会被 SearchDocs 的全量统计计入笔记本行
	riffDir := filepath.Join(util.DataDir, "storage", "riff")
	if err := os.MkdirAll(riffDir, 0755); err != nil {
		t.Fatal(err)
	}
	flashcardConf := conf.NewFlashcard()
	deck, err := riff.LoadDeck(riffDir, builtinDeckID, flashcardConf.RequestRetention, flashcardConf.MaximumInterval, flashcardConf.Weights)
	if err != nil {
		t.Fatal(err)
	}
	deck.AddCard(cardID, protectedID)
	model.Decks[builtinDeckID] = deck

	requestNotebookCounts := func(role model.Role) (counts map[string]string) {
		t.Helper()

		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		engine.POST("/api/filetree/searchDocs", searchDocs)

		recorder := httptest.NewRecorder()
		httpRequest := httptest.NewRequest(
			http.MethodPost,
			"/api/filetree/searchDocs",
			strings.NewReader(`{"k":"","flashcard":true}`),
		)
		httpRequest.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, httpRequest)
		requireAPIContract(t, http.MethodPost, "/api/filetree/searchDocs", recorder)

		response := &struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
			Data []struct {
				Path              string  `json:"path"`
				Box               string  `json:"box"`
				NewFlashcardCount *string `json:"newFlashcardCount"`
				DueFlashcardCount *string `json:"dueFlashcardCount"`
				FlashcardCount    *string `json:"flashcardCount"`
			} `json:"data"`
		}{}
		if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
			t.Fatalf("unmarshal search response failed: %v", err)
		}
		if 0 != response.Code {
			t.Fatalf("search docs failed: %s", recorder.Body.String())
		}
		for _, doc := range response.Data {
			if "/" != doc.Path || boxID != doc.Box {
				continue
			}
			if nil == doc.NewFlashcardCount || nil == doc.DueFlashcardCount || nil == doc.FlashcardCount {
				t.Fatalf("notebook row omitted flashcard counts: %s", recorder.Body.String())
			}
			return map[string]string{
				"newFlashcardCount": *doc.NewFlashcardCount,
				"dueFlashcardCount": *doc.DueFlashcardCount,
				"flashcardCount":    *doc.FlashcardCount,
			}
		}
		t.Fatalf("notebook row not found: %s", recorder.Body.String())
		return nil
	}

	readerCounts := requestNotebookCounts(model.RoleReader)
	for _, key := range []string{"newFlashcardCount", "dueFlashcardCount", "flashcardCount"} {
		if "0" != readerCounts[key] {
			t.Fatalf("reader notebook flashcard counts = %v, want all zero", readerCounts)
		}
	}
	administratorCounts := requestNotebookCounts(model.RoleAdministrator)
	for _, key := range []string{"newFlashcardCount", "dueFlashcardCount", "flashcardCount"} {
		if "1" != administratorCounts[key] {
			t.Fatalf("administrator notebook flashcard counts = %v, want all one", administratorCounts)
		}
	}
}
