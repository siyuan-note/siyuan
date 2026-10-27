package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestHTML2BlockDOMContractMathDelimiters(t *testing.T) {
	previousConf, previousMarkdown := model.Conf, util.MarkdownSettings.Load()
	model.Conf = model.NewAppConf()
	model.Conf.System.Store(&conf.System{})
	util.MarkdownSettings.Store(util.NewMarkdown())
	t.Cleanup(func() {
		model.Conf = previousConf
		util.MarkdownSettings.Store(previousMarkdown)
	})
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/lute/html2BlockDOM", html2BlockDOM)
	for _, enabled := range []bool{true, false} {
		for _, preserve := range []bool{true, false} {
			editor := conf.NewEditor()
			editor.MathDelimiterCompatibility = new(enabled)
			model.Conf.Editor.Store(editor)
			body, err := json.Marshal(map[string]any{
				"dom":              `<table><tr><th>Formula</th><th>Value</th></tr><tr><td>\(\hat VY\)</td><td>0.60</td></tr></table><p>\[x+y\]</p><p><code>\(code\)</code></p><p>unclosed \(x</p>`,
				"skipBase64Assets": true, "skipInlineSVGAssets": true, "preserveSourceFormat": preserve,
			})
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/lute/html2BlockDOM", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(recorder, request)
			requireAPIContract(t, http.MethodPost, "/api/lute/html2BlockDOM", recorder)
			var response struct {
				Code int    `json:"code"`
				Data string `json:"data"`
			}
			if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
				t.Fatalf("conversion failed: %s, %v", recorder.Body.String(), err)
			}
			want := 0
			if enabled {
				want = 1
			}
			for range 3 {
				if strings.Count(response.Data, `data-type="inline-math"`) != want || strings.Count(response.Data, `data-type="NodeMathBlock"`) != want || !strings.Contains(response.Data, "0.60") || !strings.Contains(response.Data, "code") || !strings.Contains(response.Data, "unclosed") {
					t.Fatalf("enabled=%v preserve=%v: %s", enabled, preserve, response.Data)
				}
				response.Data = util.NewLute().SpinBlockDOM(response.Data)
			}
		}
	}
}
