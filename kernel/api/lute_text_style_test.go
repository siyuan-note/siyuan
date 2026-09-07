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
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestHTML2BlockDOMQuotedFontFamily(t *testing.T) {
	originalConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.System = &conf.System{}
	t.Cleanup(func() { model.Conf = originalConf })
	gin.SetMode(gin.TestMode)
	for _, tag := range []string{"p", "h2", "td"} {
		t.Run(tag, func(t *testing.T) {
			input := `<` + tag + ` style='color:rgb(31, 35, 40);background-color:white;font-family:"Mona Sans VF", "Segoe UI", Arial;font-size:14px'>before <strong>bold</strong> <a href="https://example.com">link</a> after</` + tag + `>`
			if tag == "td" {
				input = "<table><tr>" + input + "<td>cell</td></tr></table>"
			}
			body, err := json.Marshal(map[string]any{
				"dom": input, "skipBase64Assets": true, "skipInlineSVGAssets": true, "preserveSourceFormat": true,
			})
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest(http.MethodPost, "/api/lute/html2BlockDOM", strings.NewReader(string(body)))
			context.Request.Header.Set("Content-Type", "application/json")
			html2BlockDOM(context)
			var response struct {
				Code int
				Data string
			}
			if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
				t.Fatalf("conversion failed: %s, %v", recorder.Body.String(), err)
			}
			engine := util.NewLute()
			for round := 0; round < 3; round++ {
				if strings.Contains(response.Data, "{: style=") {
					t.Fatalf("round %d leaked attributes: %s", round, response.Data)
				}
				styled, bold, link := 0, false, false
				ast.Walk(engine.BlockDOM2Tree(response.Data).Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if entering && n.Type == ast.NodeTextMark {
						if strings.TrimSpace(n.TextMarkTextContent) == "" {
							return ast.WalkContinue
						}
						style := n.IALAttr("style")
						for _, want := range []string{`font-family: "Mona Sans VF", "Segoe UI", Arial;`, "color: rgb(31, 35, 40);", "background-color: white;", "font-size: 14.000000px;"} {
							if !strings.Contains(style, want) {
								t.Errorf("round %d lost %q: %s", round, want, response.Data)
							}
						}
						styled++
						bold = bold || n.TextMarkTextContent == "bold" && n.ContainTextMarkTypes("strong")
						link = link || n.TextMarkTextContent == "link" && n.TextMarkAHref == "https://example.com"
					}
					return ast.WalkContinue
				})
				if styled < 4 || !bold || !link {
					t.Fatalf("round %d lost text or formatting: %s", round, response.Data)
				}
				response.Data = engine.SpinBlockDOM(response.Data)
			}
		})
	}
}

func TestHTML2BlockDOMMatchesElementsByDefault(t *testing.T) {
	originalConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.System = &conf.System{}
	t.Cleanup(func() { model.Conf = originalConf })
	gin.SetMode(gin.TestMode)
	input := `<h2 style="color:gray;font-family:Arial;font-size:20px"><span style="font-weight:bold">heading</span></h2>` +
		`<p><a href="https://example.com" style="color:blue;text-decoration:underline">link</a></p>`
	body, err := json.Marshal(map[string]any{
		"dom": input, "skipBase64Assets": true, "skipInlineSVGAssets": true,
	})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/lute/html2BlockDOM", strings.NewReader(string(body)))
	context.Request.Header.Set("Content-Type", "application/json")
	html2BlockDOM(context)
	var response struct {
		Code int
		Data string
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
		t.Fatalf("conversion failed: %s, %v", recorder.Body.String(), err)
	}
	for _, expected := range []string{`data-type="NodeHeading"`, `data-type="strong"`, `data-type="a"`, `data-href="https://example.com"`} {
		if !strings.Contains(response.Data, expected) {
			t.Errorf("missing %q: %s", expected, response.Data)
		}
	}
	if strings.Contains(response.Data, "style=") || strings.Contains(response.Data, `data-type="a u"`) {
		t.Fatalf("source appearance survived: %s", response.Data)
	}
}

func TestHTML2BlockDOMDoesNotLeakWhitespaceTextMarkStyles(t *testing.T) {
	originalConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.System = &conf.System{}
	t.Cleanup(func() { model.Conf = originalConf })
	gin.SetMode(gin.TestMode)
	input := `<h3 style="color: rgb(31, 35, 40); font-family: Arial; font-size: 20px; font-weight: 600">` +
		`author<span>&nbsp;</span>commented<span>&nbsp;</span><relative-time><span>now</span></relative-time></h3>`
	body, err := json.Marshal(map[string]any{
		"dom": input, "skipBase64Assets": true, "skipInlineSVGAssets": true, "preserveSourceFormat": true,
	})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/lute/html2BlockDOM", strings.NewReader(string(body)))
	context.Request.Header.Set("Content-Type", "application/json")
	html2BlockDOM(context)
	var response struct {
		Code int
		Data string
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
		t.Fatalf("conversion failed: %s, %v", recorder.Body.String(), err)
	}
	if strings.Contains(response.Data, "{: style=") {
		t.Fatalf("leaked attributes: %s", response.Data)
	}
	if !strings.Contains(response.Data, `style="color: rgb(31, 35, 40);font-family: Arial;font-size: 20.000000px;"`) {
		t.Fatalf("lost visible source formatting: %s", response.Data)
	}
	for _, text := range []string{"author", "commented", "now"} {
		if !strings.Contains(response.Data, text) {
			t.Fatalf("lost %q: %s", text, response.Data)
		}
	}
}
