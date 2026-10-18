package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func requestSettingSection(t *testing.T, role model.Role, body string) apicontract.SettingSectionData {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role) })
	engine.POST("/api/setting/getSection", getSettingSection)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/setting/getSection", strings.NewReader(body)))
	requireAPIContract(t, "POST", "/api/setting/getSection", recorder)
	var response struct {
		Code int                            `json:"code"`
		Data apicontract.SettingSectionData `json:"data"`
		Msg  string                         `json:"msg"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal getSection response failed: %s (%v)", recorder.Body.String(), err)
	}
	if response.Code != 0 {
		t.Fatalf("getSection failed: %s", response.Msg)
	}
	return response.Data
}

func TestAPIContractSettingSectionReadsSingleSection(t *testing.T) {
	previousConf, previousReadOnly := model.Conf, util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() { model.Conf, util.ReadOnly = previousConf, previousReadOnly })
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Editor.Load().FontSize = 18
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.FileTree.Load().Sort = 3
	model.Conf.AI.Store(conf.NewAI())
	model.NormalizeAppConf(model.Conf)

	data := requestSettingSection(t, model.RoleAdministrator, `{"namespace":"editor"}`)
	if data.Namespace != "editor" || data.Conf == nil || data.Conf.Editor == nil {
		t.Fatalf("missing editor section: %+v", data)
	}
	if data.Conf.Editor.FontSize != 18 {
		t.Fatalf("editor section did not reflect the stored value: %+v", data.Conf.Editor)
	}
	// 其余配置段不随单段读取返回，避免重复传输完整配置。
	if data.Conf.FileTree != nil || data.Conf.Appearance != nil || data.Conf.AI != nil || data.Conf.Keymap != nil {
		t.Fatalf("unexpected sections in a single-section response: %+v", data.Conf)
	}
	if data.SettingTasks == nil {
		t.Fatal("setting tasks snapshot missing")
	}
	if data.Revision != model.ConfNamespaceRevision("editor") {
		t.Fatalf("revision %d is not the editor revision %d", data.Revision, model.ConfNamespaceRevision("editor"))
	}
}

func TestAPIContractSettingSectionVisibility(t *testing.T) {
	previousConf, previousReadOnly := model.Conf, util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() { model.Conf, util.ReadOnly = previousConf, previousReadOnly })
	model.Conf = model.NewAppConf()
	ai := conf.NewAI()
	ai.Providers = []*conf.Provider{{ID: "20261019120000-prov001", BaseURL: "https://example.com", APIKey: "secret-key", Enabled: true}}
	model.Conf.AI.Store(ai)
	model.Conf.System.Store(conf.NewSystem())
	model.NormalizeAppConf(model.Conf)

	admin := requestSettingSection(t, model.RoleAdministrator, `{"namespace":"ai"}`)
	if admin.Conf == nil || admin.Conf.AI == nil || len(admin.Conf.AI.Providers) != 1 ||
		admin.Conf.AI.Providers[0].APIKey != "secret-key" {
		t.Fatalf("administrator did not receive AI credentials: %+v", admin.Conf)
	}

	// 非管理员使用与 getConf 相同的脱敏规则，不返回任何凭据。
	reader := requestSettingSection(t, model.RoleReader, `{"namespace":"ai"}`)
	if reader.Conf == nil || reader.Conf.AI == nil || len(reader.Conf.AI.Providers) != 0 {
		t.Fatalf("non-administrator received AI credentials: %+v", reader.Conf)
	}

	system := requestSettingSection(t, model.RoleAdministrator, `{"namespace":"system"}`)
	if system.Conf == nil || system.Conf.System == nil || system.Conf.Api == nil || system.Conf.OIDC == nil {
		t.Fatalf("system section did not include the access authorization fields: %+v", system.Conf)
	}
	// 发布角色读取 system 段时与完整配置一致，带上只读标记。
	publish := requestSettingSection(t, model.RoleReader, `{"namespace":"system"}`)
	if publish.Conf == nil || !publish.Conf.ReadOnly {
		t.Fatalf("system section lost the read-only flag: %+v", publish.Conf)
	}
}

func TestAPIContractSettingSectionRejectsUnknownNamespace(t *testing.T) {
	previousConf, previousReadOnly := model.Conf, util.ReadOnly
	util.ReadOnly = true
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { model.Conf, util.ReadOnly = previousConf, previousReadOnly })
	model.Conf = model.NewAppConf()
	model.NormalizeAppConf(model.Conf)

	engine := gin.New()
	engine.POST("/api/setting/getSection", getSettingSection)
	for _, body := range []string{`{"namespace":"unknown"}`, `{"namespace":""}`, `{}`} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/setting/getSection", strings.NewReader(body)))
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code == 0 {
			t.Fatalf("invalid namespace accepted: %s (%v)", body, err)
		}
	}
}
