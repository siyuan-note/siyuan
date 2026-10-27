// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/PuerkitoBio/goquery"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestHTML2BlockDOMContractTableRichLineBreaks(t *testing.T) {
	originalConf, originalMarkdown := model.Conf, util.MarkdownSettings.Load()
	model.Conf = model.NewAppConf()
	model.Conf.System.Store(&conf.System{})
	util.MarkdownSettings.Store(util.NewMarkdown())
	t.Cleanup(func() {
		model.Conf = originalConf
		util.MarkdownSettings.Store(originalMarkdown)
	})
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/lute/html2BlockDOM", html2BlockDOM)

	for name, content := range map[string]string{
		"single break": `<p>first<br>second</p>`,
		"formatted breaks": `<p>a. <strong>前后呼应</strong><br>` +
			`b. <strong>主次分明</strong><br>c. <strong>懂得割爱</strong></p>`,
	} {
		input := `<table><thead><tr><th><p>原则</p></th><th><p>详细解析</p></th></tr></thead>` +
			`<tbody><tr><td><p>多线架构</p></td><td>` + content + `</td></tr></tbody></table>`
		engine := util.NewLute()
		engine.SetHTMLTag2TextMark(true)
		original := engine.HTML2Tree(input).Root.FirstChild.LastChild.LastChild.TableCellRich
		if original == nil {
			t.Fatal("HTML fixture did not create a rich cell")
		}
		for _, preserve := range []bool{false, true} {
			t.Run(name+"/preserve="+strconv.FormatBool(preserve), func(t *testing.T) {
				body, err := json.Marshal(map[string]any{
					"dom": input, "skipBase64Assets": true, "skipInlineSVGAssets": true,
					"preserveSourceFormat": preserve,
				})
				if err != nil {
					t.Fatal(err)
				}
				recorder := httptest.NewRecorder()
				request := httptest.NewRequest(http.MethodPost, "/api/lute/html2BlockDOM", bytes.NewReader(body))
				router.ServeHTTP(recorder, request)
				requireAPIContract(t, http.MethodPost, request.URL.Path, recorder)
				var response struct {
					Code int    `json:"code"`
					Data string `json:"data"`
				}
				if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
					t.Fatalf("conversion failed: %s, %v", recorder.Body.String(), err)
				}
				for round := range 3 {
					doc, parseErr := goquery.NewDocumentFromReader(strings.NewReader(response.Data))
					if parseErr != nil {
						t.Fatal(parseErr)
					}
					if doc.Find("table").Length() != 1 || doc.Find("tr").Length() != 2 ||
						doc.Find("th, td").Length() != 4 || strings.Contains(doc.Text(), "table-cell-rich") {
						t.Fatalf("round %d changed the table grid or leaked metadata: %s", round, response.Data)
					}
					encoded, _ := doc.Find("td").Last().Attr(ast.TableCellRichAttribute)
					if restored := ast.DecodeTableCellRich(encoded); restored.Validate() != nil ||
						restored.Encode() != original.Encode() {
						t.Fatalf("round %d changed the rich source: %#v", round, restored)
					}
					if name == "formatted breaks" && doc.Find(`td span[data-type="strong"]`).Length() != 3 {
						t.Fatalf("round %d lost emphasis: %s", round, response.Data)
					}
					response.Data = engine.SpinBlockDOM(response.Data)
				}
			})
		}
	}
}
