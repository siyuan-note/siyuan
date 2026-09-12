package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestConfTransferPreservesLocalNetworkProxy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf, previousTemp, previousReadOnly := model.Conf, util.TempDir, util.ReadOnly
	t.Cleanup(func() {
		model.Conf, util.TempDir, util.ReadOnly = previousConf, previousTemp, previousReadOnly
	})
	util.TempDir, util.ReadOnly = t.TempDir(), true
	engine := gin.New()
	engine.POST("/export", exportConf)
	engine.POST("/import", importConf)
	for _, proxy := range []conf.NetworkProxy{
		{},
		{Scheme: "system"},
		{Scheme: "http", Host: "127.0.0.1", Port: "7890"},
	} {
		t.Run("local-"+proxy.Scheme, func(t *testing.T) {
			model.Conf = model.NewAppConf()
			model.Conf.System = &conf.System{NetworkProxy: &proxy}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/export", nil))
			response := struct {
				Code int `json:"code"`
				Data struct {
					Name string `json:"name"`
				} `json:"data"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || response.Data.Name == "" {
				t.Fatalf("export failed: %s (%v)", recorder.Body.String(), err)
			}
			data, err := os.ReadFile(filepath.Join(util.TempDir, "export", response.Data.Name))
			if err != nil {
				t.Fatal(err)
			}
			exported := model.NewAppConf()
			if err = json.Unmarshal(data, exported); err != nil {
				t.Fatal(err)
			}
			if exported.System.NetworkProxy == nil || *exported.System.NetworkProxy != (conf.NetworkProxy{}) {
				t.Fatalf("export retained network proxy: %+v", exported.System.NetworkProxy)
			}
			if *model.Conf.System.NetworkProxy != proxy {
				t.Fatal("export changed local proxy")
			}
			for _, payload := range []string{
				string(data),
				`{"system":{"networkProxy":{"scheme":"socks5","host":"old-device","port":"1080"}}}`,
				`{"system":{"networkProxy":{}}}`,
				`{"system":{"networkProxy":null}}`,
				`{"system":{}}`,
			} {
				var body bytes.Buffer
				writer := multipart.NewWriter(&body)
				part, err := writer.CreateFormFile("file", "settings.json")
				if err != nil {
					t.Fatal(err)
				}
				if _, err = part.Write([]byte(payload)); err != nil {
					t.Fatal(err)
				}
				if err = writer.Close(); err != nil {
					t.Fatal(err)
				}
				request := httptest.NewRequest(http.MethodPost, "/import", &body)
				request.Header.Set("Content-Type", writer.FormDataContentType())
				recorder = httptest.NewRecorder()
				engine.ServeHTTP(recorder, request)
				result := struct {
					Code int `json:"code"`
				}{}
				if err = json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != 0 {
					t.Fatalf("import failed: %s (%v)", recorder.Body.String(), err)
				}
				if !reflect.DeepEqual(model.Conf.System.NetworkProxy, &proxy) {
					t.Fatalf("import changed local proxy: %+v", model.Conf.System.NetworkProxy)
				}
			}
		})
	}
}
