// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"encoding/xml"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractDynamicIconGlobalFonts(t *testing.T) {
	oldConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.Editor = conf.NewEditor()
	model.Conf.Appearance = conf.NewAppearance()
	t.Cleanup(func() { model.Conf = oldConf })
	const fallback = "-apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei'"
	for _, test := range []struct {
		name   string
		fonts  []*conf.EditorFont
		family string
		weight string
	}{
		{"default", nil, fallback, "400"},
		{"ordered", []*conf.EditorFont{{Family: "Arial", Weight: 700}, {Family: "思源黑体", Weight: 300}}, `"Arial", "思源黑体", ` + fallback, "700"},
		{"invalid", []*conf.EditorFont{nil, {Family: ""}, {Family: "Arial", Weight: 1001}}, `"Arial", ` + fallback, "400"},
		{"escaped", []*conf.EditorFont{{Family: "A\"\\\n<&';font-weight:1", Weight: 500}}, `"A\22 \5c \a <&';font-weight:1", ` + fallback, "500"},
	} {
		for _, allowScript := range []bool{false, true} {
			for _, iconType := range []string{"1", "2", "3", "4", "5", "6", "7", "8", "", "unknown"} {
				t.Run(fmt.Sprintf("%s/type%s/script%t", test.name, iconType, allowScript), func(t *testing.T) {
					model.Conf.Appearance.GlobalFontFamilies = test.fonts
					model.Conf.Editor.AllowSVGScript = allowScript
					recorder := httptest.NewRecorder()
					context, _ := gin.CreateTestContext(recorder)
					context.Request = httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/icon/getDynamicIcon?type=%s&content=Text&date=2026-09-29&lang=en", iconType), nil)
					getDynamicIcon(context)
					requireAPIContract(t, http.MethodGet, "/api/icon/getDynamicIcon", recorder)
					var svg struct {
						XMLName xml.Name `xml:"svg"`
						Family  string   `xml:"font-family,attr"`
						Weight  string   `xml:"font-weight,attr"`
						Texts   []struct {
							Style string `xml:"style,attr"`
						} `xml:"text"`
					}
					if err := xml.Unmarshal(recorder.Body.Bytes(), &svg); err != nil {
						t.Fatal(err)
					}
					family, weight := fallback, "400"
					if "8" == iconType {
						family, weight = test.family, test.weight
					}
					if svg.Family != family || svg.Weight != weight {
						t.Fatalf("unexpected font: %q / %q", svg.Family, svg.Weight)
					}
					if len(svg.Texts) == 0 {
						t.Fatal("missing icon text")
					}
					for _, text := range svg.Texts {
						if strings.Contains(text.Style, "font-family") || strings.Contains(text.Style, "font-weight") {
							t.Fatalf("text overrides inherited font: %s", text.Style)
						}
					}
					if recorder.Header().Get("Cache-Control") != "no-cache" || recorder.Header().Get("Vary") != "Cookie" {
						t.Fatal("dynamic icon cache headers changed")
					}
				})
			}
		}
	}
}

func TestGenerateTypeEightSVGEscapesContent(t *testing.T) {
	content := `</text><desc><style><script>alert(1)</script></style></desc><text>`
	output := generateTypeEightSVG("red", content)
	if strings.Contains(output, `<script>`) || strings.Contains(output, `</text><desc>`) {
		t.Fatalf("dynamic icon contains injected SVG markup: %s", output)
	}
	if !strings.Contains(output, `&lt;/text&gt;`) {
		t.Fatalf("dynamic icon content was not escaped: %s", output)
	}
}

func TestGenerateTypeEightSVGCalculatesFontSizeBeforeEscaping(t *testing.T) {
	output := generateTypeEightSVG("red", "<")
	if !strings.Contains(output, `font-size: 480.00px`) || !strings.Contains(output, `&lt;`) {
		t.Fatalf("escaped content changed the dynamic icon font size: %s", output)
	}
}

func TestGenerateTypeEightSVGHandlesEmptyContent(t *testing.T) {
	output := generateTypeEightSVG("red", "")
	if strings.Contains(output, "font-size") || strings.Contains(output, "Inf") || strings.Contains(output, "NaN") {
		t.Fatalf("empty dynamic icon content produced an invalid font size: %s", output)
	}
	if !strings.Contains(output, `id="dynamic_icon_type8"`) {
		t.Fatalf("empty dynamic icon content lost the icon frame: %s", output)
	}
}

func TestGetDynamicIconSetsSecurityHeaders(t *testing.T) {
	oldConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.Editor = conf.NewEditor()
	t.Cleanup(func() {
		model.Conf = oldConf
	})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	request := httptest.NewRequest(http.MethodGet, "/api/icon/getDynamicIcon?type=8&content=%3Cscript%3Ealert(1)%3C%2Fscript%3E", nil)
	context.Request = request
	getDynamicIcon(context)
	requireAPIContract(t, http.MethodGet, "/api/icon/getDynamicIcon", recorder)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status code %d", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), `<script>`) {
		t.Fatalf("dynamic icon response contains injected script: %s", recorder.Body.String())
	}
	if recorder.Header().Get("Content-Security-Policy") != "script-src 'none'; object-src 'none'; base-uri 'none'" {
		t.Fatalf("unexpected CSP header %q", recorder.Header().Get("Content-Security-Policy"))
	}
	if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("unexpected X-Content-Type-Options header %q", recorder.Header().Get("X-Content-Type-Options"))
	}
}
