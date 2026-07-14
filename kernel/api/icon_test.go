// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestGenerateTypeEightSVGEscapesContent(t *testing.T) {
	content := `</text><desc><style><script>alert(1)</script></style></desc><text>`
	output := generateTypeEightSVG("red", content, "")
	if strings.Contains(output, `<script>`) || strings.Contains(output, `</text><desc>`) {
		t.Fatalf("dynamic icon contains injected SVG markup: %s", output)
	}
	if !strings.Contains(output, `&lt;/text&gt;`) {
		t.Fatalf("dynamic icon content was not escaped: %s", output)
	}
}

func TestGenerateTypeEightSVGCalculatesFontSizeBeforeEscaping(t *testing.T) {
	output := generateTypeEightSVG("red", "<", "")
	if !strings.Contains(output, `font-size: 480.00px`) || !strings.Contains(output, `&lt;`) {
		t.Fatalf("escaped content changed the dynamic icon font size: %s", output)
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
