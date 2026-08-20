// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
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
	model.Conf.Lang = "test"
	util.Langs = map[string]map[int]string{
		"test": {285: passwordIncorrect},
		"en":   {285: passwordIncorrect},
	}
	t.Cleanup(func() {
		util.DataDir = oldDataDir
		model.Conf = oldConf
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
	model.Conf.Lang = "test"
	util.Langs = map[string]map[int]string{
		"test": {285: "Password is incorrect", 354: passwordLocked},
		"en":   {285: "Password is incorrect", 354: passwordLocked},
	}
	t.Cleanup(func() {
		util.DataDir = oldDataDir
		model.Conf = oldConf
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
	defer util.AuthThrottleReset(attackerIP)

	// 前 5 次失败为普通失败响应，第 6 次失败触发锁定但本次仍返回普通响应（与 util.AuthThrottleFail 语义一致）
	for i := 0; i < 6; i++ {
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
	util.AuthThrottleReset(attackerIP)
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
	model.Conf.Lang = "test"
	util.Langs = map[string]map[int]string{
		"test": {313: "Encrypted notebooks do not support this operation"},
		"en":   {313: "Encrypted notebooks do not support this operation"},
	}
	if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		util.DataDir = oldDataDir
		model.Conf = oldConf
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
	model.Conf.FileTree = conf.NewFileTree()
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
	model.Conf.Editor = conf.NewEditor()
	model.Conf.Export = conf.NewExport()
	model.Conf.FileTree = conf.NewFileTree()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Sync = conf.NewSync()

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
	const (
		boxID             = "20260725000000-boxid01"
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
	for _, id := range ids {
		treenode.IndexBlockTree(&parse.Tree{
			ID:    id,
			Box:   boxID,
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

	expectedPaths := paths[:3]
	if filtered := filterFileTreePathsByPublishMetadataAccess(c, paths); !slices.Equal(filtered, expectedPaths) {
		t.Fatalf("unexpected unauthenticated reader paths: %v", filtered)
	}
	expectedIDs := []string{publicID, protectedID}
	if filtered := filterFileTreeBlockIDsByPublishDiscoverability(c, allIDs, boxID); !slices.Equal(filtered, expectedIDs) {
		t.Fatalf("unexpected reader discoverable IDs: %v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + privateID,
		Value: util.SHA256Hash([]byte(privateID + privatePassword)),
	})
	expectedPaths = paths[:4]
	if filtered := filterFileTreePathsByPublishMetadataAccess(c, paths); !slices.Equal(filtered, expectedPaths) {
		t.Fatalf("unexpected authenticated reader paths: %v", filtered)
	}
	if filtered := filterFileTreeBlockIDsByPublishDiscoverability(c, allIDs, boxID); !slices.Equal(filtered, expectedIDs) {
		t.Fatalf("private documents should remain undiscoverable: %v", filtered)
	}

	c.Set(model.RoleContextKey, model.RoleAdministrator)
	if filtered := filterFileTreePathsByPublishMetadataAccess(c, paths); !slices.Equal(filtered, paths) {
		t.Fatalf("administrator paths should remain unchanged: %v", filtered)
	}
	if filtered := filterFileTreeBlockIDsByPublishDiscoverability(c, allIDs, boxID); !slices.Equal(filtered, allIDs) {
		t.Fatalf("administrator IDs should remain unchanged: %v", filtered)
	}
}
