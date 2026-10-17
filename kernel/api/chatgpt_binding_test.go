package api

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractChatGPTLocalBindingsAndConfTransfer(t *testing.T) {
	aiContractConfiguration(t)
	home, workspace, confDir, temp, readOnly := util.HomeDir, util.WorkspaceDir, util.ConfDir, util.TempDir, util.ReadOnly
	t.Cleanup(func() {
		util.HomeDir, util.WorkspaceDir, util.ConfDir, util.TempDir, util.ReadOnly = home, workspace, confDir, temp, readOnly
	})
	util.HomeDir, util.WorkspaceDir, util.ConfDir, util.TempDir, util.ReadOnly = t.TempDir(), t.TempDir(), t.TempDir(), t.TempDir(), false
	model.NormalizeAppConf(model.Conf)
	const providerID = "20261015120000-prov001"
	payload := `{"providers":[{"id":"20261015120000-prov001","authType":"chatgpt","accountID":"local-account"}]}`
	code, message, data := settingContractRequest(t, "setAI", setAI, payload)
	if code != 0 {
		t.Fatal(message)
	}
	var saved apicontract.SettingAI
	if err := json.Unmarshal(data, &saved); err != nil || saved.Providers[0].AccountID != "local-account" {
		t.Fatalf("response did not retain local selection: %s", data)
	}
	bindings, err := util.ChatGPTService().LoadBindings(util.WorkspaceDir)
	if err != nil || bindings[providerID] != "local-account" {
		t.Fatalf("binding not saved: %v %v", bindings, err)
	}
	persisted, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil || bytes.Contains(persisted, []byte("accountID")) {
		t.Fatal("workspace configuration retained a local binding")
	}
	recorder := systemContractRequest(t, http.MethodPost, "exportConf", exportConf, nil)
	var exported struct {
		Code int                              `json:"code"`
		Data apicontract.SystemExportConfData `json:"data"`
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &exported); err != nil || exported.Code != 0 {
		t.Fatalf("export failed: %s", recorder.Body.String())
	}
	configuration, err := os.ReadFile(filepath.Join(util.TempDir, "export", exported.Data.Name))
	if err != nil || bytes.Contains(configuration, []byte("accountID")) || model.Conf.AI.Load().Providers[0].AccountID != "local-account" {
		t.Fatal("export leaked or changed a local binding")
	}
	for _, imported := range []string{string(configuration), `{"ai":{"providers":[{"id":"20261015120000-prov001","authType":"chatgpt","accountID":"foreign-account"},{"id":"20261015120000-prov002","authType":"chatgpt","accountID":"foreign-account"}]}}`} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", "settings.json")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write([]byte(imported)); err != nil {
			t.Fatal(err)
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/system/importConf", &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())
		importConf(c)
		requireAPIContract(t, "POST", "/api/system/importConf", response)
		var result struct {
			Code int `json:"code"`
		}
		if err = json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code != 0 {
			t.Fatalf("import failed: %s", response.Body.String())
		}
		for _, provider := range model.Conf.AI.Load().Providers {
			want := ""
			if provider.ID == providerID {
				want = "local-account"
			}
			if provider.AccountID != want {
				t.Fatalf("import replaced local binding: %+v", provider)
			}
		}
	}
	code, message, _ = settingContractRequest(t, "setAI", setAI, `{"providers":[]}`)
	if code != 0 {
		t.Fatal(message)
	}
	bindings, err = util.ChatGPTService().LoadBindings(util.WorkspaceDir)
	if err != nil || len(bindings) != 0 {
		t.Fatal("removed providers retained their bindings")
	}
	if err = util.ChatGPTService().SaveBindings(context.Background(), util.WorkspaceDir, map[string]string{providerID: "local-account"}); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(util.HomeDir, ".config", "siyuan", "chatgpt", "bindings", "*.json"))
	if len(files) != 1 {
		t.Fatalf("unexpected binding files: %v", files)
	}
	if err = os.WriteFile(files[0], []byte("damaged"), 0600); err != nil {
		t.Fatal(err)
	}
	before := model.Conf.AI.Load()
	code, _, _ = settingContractRequest(t, "setAI", setAI, payload)
	if code != -1 || model.Conf.AI.Load() != before {
		t.Fatal("failed binding write published configuration")
	}
}
