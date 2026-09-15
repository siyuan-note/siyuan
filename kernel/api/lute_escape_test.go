package api

import (
	"bytes"
	"encoding/json"
	"html"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/PuerkitoBio/goquery"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestHTML2BlockDOMContractEscapedText(t *testing.T) {
	originalConf, originalMarkdown := model.Conf, util.MarkdownSettings
	model.Conf = model.NewAppConf()
	model.Conf.System = &conf.System{}
	t.Cleanup(func() {
		model.Conf, util.MarkdownSettings = originalConf, originalMarkdown
	})
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/lute/html2BlockDOM", html2BlockDOM)

	const punctuation = "a = b \\= \\ * _ ~ $ ^ <t> `c"
	type testCase struct {
		name, dom, text string
		marks           map[string]string
	}
	tests := []testCase{
		{"issue19555", `<strong style="font-weight:600;color:rgb(15,17,21);font-size:16px"><code style="font-weight:400">cu</code><span class=""> = CUDA</span></strong>`, "cu = CUDA", map[string]string{"strong": "cu = CUDA", "code": "cu"}},
		{"plain", "<p>" + html.EscapeString(punctuation) + "</p>", punctuation, nil},
		{"nested", `<strong>1 = <em>2 \\ 3</em><code> = 4</code></strong>`, `1 = 2 \\ 3 = 4`, map[string]string{"strong": `1 = 2 \\ 3 = 4`, "em": `2 \\ 3`, "code": " = 4"}},
		{"link", `<a href="https://example.com/?a=1&amp;b=2">a = b</a>`, "a = b", map[string]string{"a": "a = b"}},
		{"code", "<code>" + html.EscapeString(punctuation) + "</code>", punctuation, map[string]string{"code": punctuation}},
		{"table", `<table><tr><td><strong>1 = 2</strong></td><td>tail</td></tr></table>`, "1 = 2tail", map[string]string{"strong": "1 = 2"}},
		{"styledSibling", `<p><span style="color:red">color</span><strong>1 = 2</strong></p>`, "color1 = 2", map[string]string{"strong": "1 = 2"}},
		{"styledText", `<strong style="color:red">a = b</strong>`, "a = b", map[string]string{"strong": "a = b"}},
		{"underline", `<u>a = b</u>`, "a = b", map[string]string{"u": "a = b"}},
		{"entities", `<strong>&amp; &lt;tag&gt; &amp;lt; &quot; &#39;</strong>`, `& <tag> &lt; " '`, map[string]string{"strong": `& <tag> &lt; " '`}},
		{"differentStyles", `<strong style="color:red">a = b</strong><strong style="color:blue">c = d</strong>`, "a = bc = d", map[string]string{"strong": "a = bc = d"}},
		{"differentLinkTitles", `<strong><a href="https://example.com" title="one">1 = 2</a><a href="https://example.com" title="two">3 = 4</a></strong>`, "1 = 23 = 4", map[string]string{"strong": "1 = 23 = 4", "a": "1 = 23 = 4"}},
	}
	for _, tag := range []string{"strong", "em", "s", "mark", "sup", "sub", "kbd"} {
		tests = append(tests, testCase{tag, "<" + tag + ">" + html.EscapeString(punctuation) + "</" + tag + ">", punctuation, map[string]string{tag: punctuation}})
	}

	for _, syntax := range []bool{true, false} {
		settings := *originalMarkdown
		settings.InlineAsterisk, settings.InlineUnderscore = syntax, syntax
		settings.InlineStrikethrough, settings.InlineMark = syntax, syntax
		settings.InlineSup, settings.InlineSub, settings.InlineMath = syntax, syntax, syntax
		util.MarkdownSettings = &settings
		for _, preserve := range []bool{false, true} {
			for _, test := range tests {
				t.Run(test.name+"/syntax="+strconv.FormatBool(syntax)+"/preserve="+strconv.FormatBool(preserve), func(t *testing.T) {
					body, err := json.Marshal(map[string]any{
						"dom": test.dom, "skipBase64Assets": true, "skipInlineSVGAssets": true, "preserveSourceFormat": preserve,
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
					engine := util.NewLute()
					for round := 0; round < 3; round++ {
						doc, parseErr := goquery.NewDocumentFromReader(strings.NewReader(response.Data))
						if parseErr != nil {
							t.Fatal(parseErr)
						}
						content := doc.Find(`[contenteditable="true"]`).First()
						withoutPlaceholders := strings.NewReplacer("\u200b", "", "\u2060", "")
						actual := withoutPlaceholders.Replace(content.Text())
						if actual != test.text {
							t.Fatalf("round %d: expected text %q, got %q\n%s", round, test.text, actual, response.Data)
						}
						for mark, expected := range test.marks {
							actual = withoutPlaceholders.Replace(content.Find(`span[data-type~="` + mark + `"]`).Text())
							// 边缘空白可以位于格式标记外，正文断言仍逐字符校验空白数量。
							if strings.ReplaceAll(actual, " ", "") != strings.ReplaceAll(expected, " ", "") {
								t.Fatalf("round %d: expected %s text %q, got %q\n%s", round, mark, expected, actual, response.Data)
							}
						}
						if strings.Contains(response.Data, "{: style=") {
							t.Fatalf("round %d leaked style attributes: %s", round, response.Data)
						}
						if test.name == "differentStyles" && preserve {
							for color, expected := range map[string]string{"red": "a = b", "blue": "c = d"} {
								if actual = content.Find(`span[style="color: ` + color + `;"]`).Text(); actual != expected {
									t.Fatalf("round %d: %s style boundary changed: %s", round, color, response.Data)
								}
							}
						}
						if test.name == "differentLinkTitles" && round == 0 {
							for title, expected := range map[string]string{"one": "1 = 2", "two": "3 = 4"} {
								if actual = content.Find(`span[data-title="` + title + `"]`).Text(); actual != expected {
									t.Fatalf("round %d: link title boundary changed: %s", round, response.Data)
								}
							}
						}
						response.Data = engine.SpinBlockDOM(response.Data)
					}
				})
			}
		}
	}
}
