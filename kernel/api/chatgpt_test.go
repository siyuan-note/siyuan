package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractChatGPTAccountLifecycle(t *testing.T) {
	aiContractConfiguration(t)
	oldHome := util.HomeDir
	util.HomeDir = t.TempDir()
	t.Cleanup(func() { util.HomeDir = oldHome })
	engine := gin.New()
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	engine.POST("/api/ai/chatgpt/accounts", chatGPTAccounts)
	engine.POST("/api/ai/chatgpt/start", chatGPTStart)
	engine.POST("/api/ai/chatgpt/status", chatGPTStatus)
	engine.POST("/api/ai/chatgpt/cancel", chatGPTCancel)
	engine.POST("/api/ai/chatgpt/import", chatGPTImport)
	engine.POST("/api/ai/chatgpt/export", chatGPTExport)
	engine.POST("/api/ai/chatgpt/logout", chatGPTLogout)
	request := func(path, body string) map[string]json.RawMessage {
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
		if err := bundle.ValidateHTTPResponse("POST", path, w.Code, w.Header().Get("Content-Type"), w.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
		var result map[string]json.RawMessage
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	accounts := request("/api/ai/chatgpt/accounts", "")
	if string(accounts["data"]) != "[]" {
		t.Fatalf("accounts: %s", accounts["data"])
	}
	result := request("/api/ai/chatgpt/start", `{}`)
	var login apicontract.ChatGPTLogin
	json.Unmarshal(result["data"], &login)
	if login.ID == "" || !strings.HasPrefix(login.URL, "https://auth.openai.com/") {
		t.Fatal("invalid login")
	}
	body, _ := json.Marshal(apicontract.ChatGPTLoginRequest{ID: login.ID})
	t.Cleanup(func() { util.ChatGPTService().Cancel(login.ID) })
	request("/api/ai/chatgpt/status", string(body))
	request("/api/ai/chatgpt/cancel", string(body))
	for _, path := range []string{"import", "export", "logout"} {
		result = request("/api/ai/chatgpt/"+path, `{"accountID":"missing","password":"short","data":"{}"}`)
		if string(result["code"]) != "-1" {
			t.Fatalf("invalid %s accepted", path)
		}
	}
}

func TestAPIContractChatGPTCallbackUsesSharedPage(t *testing.T) {
	aiContractConfiguration(t)
	oldHome := util.HomeDir
	util.HomeDir = t.TempDir()
	t.Cleanup(func() { util.HomeDir = oldHome })
	engine := gin.New()
	engine.POST("/api/ai/chatgpt/start", chatGPTStart)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/ai/chatgpt/start", strings.NewReader(`{}`)))
	var result struct {
		Data apicontract.ChatGPTLogin `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Data.ID == "" {
		t.Fatalf("unable to start sign-in: %s", recorder.Body.String())
	}
	t.Cleanup(func() { util.ChatGPTService().Cancel(result.Data.ID) })
	authorization, err := url.Parse(result.Data.URL)
	if err != nil {
		t.Fatal(err)
	}
	query := url.Values{"state": {authorization.Query().Get("state")}, "error": {"access_denied"}}
	response, err := http.Get(authorization.Query().Get("redirect_uri") + "?" + query.Encode())
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	page := string(body)
	if response.Header.Get("Content-Type") != "text/html; charset=utf-8" ||
		!strings.Contains(page, `class="brand">SiYuan</div>`) || !strings.Contains(page, `class="mark mark--error"`) ||
		strings.Contains(page, "access_denied") || strings.Contains(page, "window.close") {
		t.Fatalf("callback did not use the shared failure page: %s", page)
	}
}

func TestAPIContractChatGPTAuthorizationBeforeBody(t *testing.T) {
	aiContractConfiguration(t)
	oldHome, oldReadonly := util.HomeDir, util.ReadOnly
	util.HomeDir = t.TempDir()
	t.Cleanup(func() { util.HomeDir = oldHome; util.ReadOnly = oldReadonly })
	for _, role := range []model.Role{model.RoleReader, model.RoleEditor, model.RoleAdministrator} {
		util.ReadOnly = role == model.RoleAdministrator
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
		ServeAPI(engine)
		paths := []string{"start", "cancel", "logout", "export", "import"}
		if role != model.RoleAdministrator {
			paths = append(paths, "accounts", "status")
		}
		for _, path := range paths {
			request := httptest.NewRequest("POST", "/api/ai/chatgpt/"+path, nil)
			request.Body = aiUnreadBody{t: t}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			if role != model.RoleAdministrator && recorder.Code != 403 {
				t.Fatalf("non-admin request accepted: %s", path)
			}
			if role == model.RoleAdministrator && !strings.Contains(recorder.Body.String(), `"code":-1`) {
				t.Fatalf("read-only request accepted: %s", path)
			}
		}
	}
	if _, err := os.Stat(filepath.Join(util.HomeDir, ".config", "siyuan", "chatgpt")); !os.IsNotExist(err) {
		t.Fatal("denied request created credentials")
	}
}
