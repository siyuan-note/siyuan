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
)

func TestHTML2BlockDOMNormalizesIFramePosition(t *testing.T) {
	originalConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.System = &conf.System{}
	t.Cleanup(func() { model.Conf = originalConf })

	tests := []struct {
		name          string
		style         string
		wantStyle     string
		rejectedStyle string
	}{
		{
			name:          "absolute",
			style:         "position:absolute;top:0;left:0;width:100%;height:100%;border:0",
			rejectedStyle: "position:absolute",
		},
		{
			name:          "computed absolute",
			style:         "box-sizing: border-box; border: 0px; color-scheme: auto; position: absolute; top: 0px; left: 0px; width: 958px; height: 538.875px;",
			rejectedStyle: "position: absolute",
		},
		{
			name:          "fixed important",
			style:         "POSITION: FIXED !important;inset:0",
			rejectedStyle: "POSITION: FIXED",
		},
		{
			name:      "relative",
			style:     "position:relative;width:640px;height:360px",
			wantStyle: "position:relative;width:640px;height:360px",
		},
	}

	gin.SetMode(gin.TestMode)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			requestBody, err := json.Marshal(map[string]any{
				"dom":                 `<iframe src="https://example.com/embed" style="` + test.style + `"></iframe>`,
				"skipBase64Assets":    true,
				"skipInlineSVGAssets": true,
			})
			if err != nil {
				t.Fatal(err)
			}

			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest(http.MethodPost, "/api/lute/html2BlockDOM", strings.NewReader(string(requestBody)))
			context.Request.Header.Set("Content-Type", "application/json")

			html2BlockDOM(context)

			response := struct {
				Code int    `json:"code"`
				Data string `json:"data"`
			}{}
			if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Code != 0 || !strings.Contains(response.Data, `data-type="NodeIFrame"`) {
				t.Fatalf("unexpected conversion response: %s", recorder.Body.String())
			}
			if !strings.Contains(response.Data, `src="https://example.com/embed"`) {
				t.Fatalf("iframe source was not retained: %s", response.Data)
			}
			if test.rejectedStyle != "" && strings.Contains(response.Data, test.rejectedStyle) {
				t.Fatalf("out-of-flow style was retained: %s", response.Data)
			}
			if test.rejectedStyle != "" && strings.Contains(response.Data, ` style=`) {
				t.Fatalf("dependent iframe style was retained: %s", response.Data)
			}
			if test.wantStyle != "" && !strings.Contains(response.Data, test.wantStyle) {
				t.Fatalf("in-flow style was removed: %s", response.Data)
			}
		})
	}
}

func TestNormalizeIFramePositionIAL(t *testing.T) {
	node := &ast.Node{
		Type:   ast.NodeIFrame,
		Tokens: []byte(`<iframe src="https://example.com/embed"></iframe>`),
	}
	node.SetIALAttr("style", "position: absolute; width: 958px; height: 538.875px;")

	normalizeIFramePosition(node)

	if style := node.IALAttr("style"); style != "" {
		t.Fatalf("out-of-flow IAL style was retained: %s", style)
	}
	if !strings.Contains(node.TokensStr(), `src="https://example.com/embed"`) {
		t.Fatalf("iframe source was not retained: %s", node.TokensStr())
	}
}
