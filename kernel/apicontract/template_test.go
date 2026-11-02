// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"strings"
	"testing"
)

func TestTemplateRenderCompatibility(t *testing.T) {
	for _, entry := range []struct {
		fields, mode               string
		invalidMode, invalidSource bool
	}{
		{`"mode":"preview","preview":"ignored","content":""`, "preview", false, false},
		{`"mode":null,"preview":true`, "preview", false, false},
		{`"mode":"editorInsert","preview":true`, "editorInsert", false, false},
		{`"preview":false`, "content", false, false},
		{`"mode":"content"`, "", true, false},
		{`"mode":true`, "", true, false},
		{`"mode":"preview","content":null`, "preview", false, true},
		{`"mode":"editorInsert","content":""`, "editorInsert", false, true},
	} {
		request, err := RenderTemplate.Decode(strings.NewReader(`{"path":" file ","id":" id ",` + entry.fields + `}`))
		if err != nil || request.Path != " file " || request.ID != " id " {
			t.Fatalf("early validation or trimming changed: %+v %v", request, err)
		}
		mode, err := request.RenderMode()
		if (err != nil) != entry.invalidMode || mode != entry.mode {
			t.Fatalf("mode precedence changed for %s: %s %v", entry.fields, mode, err)
		}
		if !entry.invalidMode {
			_, err = request.PreviewSource(mode)
			if (err != nil) != entry.invalidSource {
				t.Fatalf("source validation changed: %s %v", entry.fields, err)
			}
		}
	}
}

func TestTemplateHTTPConfirmationHandoffContract(t *testing.T) {
	request, err := RenderTemplate.Decode(strings.NewReader(`{"path":"template.md","id":"document","mode":"editorInsert","httpConfirmToken":"opaque-preview-token"}`))
	if err != nil || request.HTTPConfirmToken != "opaque-preview-token" {
		t.Fatalf("handoff lost: %+v %v", request, err)
	}
	request, err = RenderTemplate.Decode(strings.NewReader(`{"path":"template.md","id":"document","mode":"preview"}`))
	if err != nil || request.HTTPConfirmToken != "" {
		t.Fatalf("legacy preview changed: %+v %v", request, err)
	}
	if _, err = RenderTemplate.Decode(strings.NewReader(`{"path":"template.md","id":"document","httpConfirmToken":true}`)); err == nil {
		t.Fatal("non-string handoff accepted")
	}
}

func TestTemplateHTTPPermissionContracts(t *testing.T) {
	for _, scope := range []string{"once", "template"} {
		request, err := RespondTemplateHTTP.Decode(strings.NewReader(`{"executionID":"execution","confirmID":"confirmation","approved":true,"app":"app","session":"main","scope":"` + scope + `"}`))
		if err != nil || request.Scope != scope {
			t.Fatalf("confirmation scope lost: %+v %v", request, err)
		}
	}
	request, err := TemplateHTTPPermission.Decode(strings.NewReader(`{"action":"get","kind":"av","avID":"database","keyID":"field","slot":"renderTemplate"}`))
	if err != nil || request.Action != "get" || request.Slot != "renderTemplate" || request.KeyID != "field" {
		t.Fatalf("field permission identity lost: %+v %v", request, err)
	}
	if _, err = TemplateHTTPPermission.Decode(strings.NewReader(`{"action":"revoke","kind":true}`)); err == nil {
		t.Fatal("non-string source kind accepted")
	}
}
