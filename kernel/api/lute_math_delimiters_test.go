// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
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
	fixtureJSON, err := os.ReadFile("../../app/tests/fixtures/chatgpt-math-clipboard.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ HTML, Text string }
	if err = json.Unmarshal(fixtureJSON, &fixture); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, html, text string
		inline, block    int
	}{
		{"basic", `<table><tr><th>Formula</th><th>Value</th></tr><tr><td>\(\hat VY\)</td><td>0.60</td></tr></table><p>\[x+y\]</p><p><code>\(code\)</code></p><p>unclosed \(x</p>`, "", 1, 1},
		{"captured ChatGPT", fixture.HTML, fixture.Text, 3, 2},
		{"styled and protected", `<p><strong>\(x+y\)</strong> <em>\(z\)</em></p><p><mark>\[w\]</mark></p><p><a href="https://example.com/\(path\)">\(link\)</a> <code>\(code\)</code></p>`, "", 2, 1},
	}
	for _, enabled := range []bool{true, false} {
		for _, preserve := range []bool{true, false} {
			for _, tc := range cases {
				editor := conf.NewEditor()
				editor.MathDelimiterCompatibility = new(enabled)
				model.Conf.Editor.Store(editor)
				body, err := json.Marshal(map[string]any{
					"dom": tc.html, "text": tc.text,
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
				wantInline, wantBlock := tc.inline, tc.block
				if !enabled {
					wantInline, wantBlock = 0, 0
				}
				for range 3 {
					if strings.Count(response.Data, `data-subtype="math"`)-strings.Count(response.Data, `data-type="NodeMathBlock"`) != wantInline || strings.Count(response.Data, `data-type="NodeMathBlock"`) != wantBlock {
						t.Fatalf("%s enabled=%v preserve=%v: %s", tc.name, enabled, preserve, response.Data)
					}
					if tc.name == "basic" {
						for _, text := range []string{"0.60", "code", "unclosed"} {
							if !strings.Contains(response.Data, text) {
								t.Fatalf("lost %q: %s", text, response.Data)
							}
						}
					} else if tc.name == "captured ChatGPT" {
						for _, formula := range []string{`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`, `e^{i\pi}+1=0`} {
							want := formula
							if enabled {
								want = `data-content="` + formula + `"`
							}
							if !strings.Contains(response.Data, want) {
								t.Fatalf("lost table formula %q: %s", formula, response.Data)
							}
						}
					} else {
						for _, text := range []string{"link", "code", `https://example.com/\(path\)`} {
							if !strings.Contains(response.Data, text) {
								t.Fatalf("lost protected content %q: %s", text, response.Data)
							}
						}
					}
					response.Data = util.NewLute().SpinBlockDOM(response.Data)
				}
			}
		}
	}
}
