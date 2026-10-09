package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingFileTreeClickMode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf, previousReadOnly := model.Conf, util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() { model.Conf, util.ReadOnly = previousConf, previousReadOnly })
	engine := gin.New()
	engine.POST("/api/setting/setFiletree", setFiletree)
	engine.POST("/api/setting/patch", patchSetting)
	for _, entry := range []struct {
		path, body     string
		docIcon, title int
		echo           bool // setFiletree 响应回显应用后的取值
	}{
		// setFiletree 为整体替换，未提交的字段回到默认值
		{"/api/setting/setFiletree", `{}`, 0, 0, true},
		{"/api/setting/setFiletree", `{"docIconClickMode":1,"parentDocTitleClickMode":2}`, 1, 2, true},
		{"/api/setting/setFiletree", `{"DocIconClickMode":1,"ParentDocTitleClickMode":1}`, 1, 1, true},
		{"/api/setting/setFiletree", `{"docIconClickMode":2,"parentDocTitleClickMode":9}`, 0, 0, true},
		{"/api/setting/setFiletree", `{"docIconClickMode":-1}`, 0, 0, true},
		// patch 在现有配置上合并，未提交的字段保留当前值，null 按零值处理
		{"/api/setting/patch", `{"fileTree":{"docIconClickMode":1}}`, 1, 1, false},
		{"/api/setting/patch", `{"fileTree":{"parentDocTitleClickMode":2}}`, 0, 2, false},
		{"/api/setting/patch", `{"fileTree":{"docIconClickMode":null}}`, 0, 1, false},
		{"/api/setting/patch", `{"fileTree":{"parentDocTitleClickMode":9}}`, 0, 0, false},
	} {
		model.Conf = model.NewAppConf()
		model.Conf.FileTree = conf.NewFileTree()
		model.Conf.FileTree.ParentDocTitleClickMode = 1
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest("POST", entry.path, strings.NewReader(entry.body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, "POST", entry.path, recorder)
		var response struct {
			Code int                          `json:"code"`
			Data *apicontract.SettingFileTree `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Code != 0 {
			t.Fatalf("setting failed: %s", recorder.Body.String())
		}
		if entry.echo && (response.Data == nil ||
			response.Data.DocIconClickMode != entry.docIcon ||
			response.Data.ParentDocTitleClickMode != entry.title) {
			t.Fatalf("response lost the click modes: %s", recorder.Body.String())
		}
		if model.Conf.FileTree.DocIconClickMode != entry.docIcon ||
			model.Conf.FileTree.ParentDocTitleClickMode != entry.title {
			t.Fatalf("%s %s: want %d/%d, got %d/%d", entry.path, entry.body, entry.docIcon, entry.title,
				model.Conf.FileTree.DocIconClickMode, model.Conf.FileTree.ParentDocTitleClickMode)
		}
	}
}

func TestAPIContractSettingFileTreeClickModeRejectsWrongTypes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf, previousReadOnly := model.Conf, util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() { model.Conf, util.ReadOnly = previousConf, previousReadOnly })
	engine := gin.New()
	engine.POST("/api/setting/setFiletree", setFiletree)
	engine.POST("/api/setting/patch", patchSetting)
	for _, entry := range []string{
		`{"docIconClickMode":"1"}`,
		`{"parentDocTitleClickMode":"1"}`,
		`{"docIconClickMode":1.5}`,
		`{"parentDocTitleClickMode":true}`,
	} {
		for _, path := range []string{"/api/setting/setFiletree", "/api/setting/patch"} {
			model.Conf = model.NewAppConf()
			model.Conf.FileTree = conf.NewFileTree()
			body := entry
			if path == "/api/setting/patch" {
				body = `{"fileTree":` + entry + `}`
			}
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest("POST", path, strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)
			var response struct {
				Code int    `json:"code"`
				Msg  string `json:"msg"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Code == 0 {
				t.Fatalf("%s %s: invalid value accepted", path, body)
			}
			if 0 != model.Conf.FileTree.DocIconClickMode || 0 != model.Conf.FileTree.ParentDocTitleClickMode {
				t.Fatalf("%s %s: configuration changed on rejection", path, body)
			}
		}
	}
}
