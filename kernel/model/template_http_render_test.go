// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
)

func TestTemplateHTTPDocumentFallbackAndNoRerun(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.Editor.Store(conf.NewEditor())
	Conf.Export.Store(conf.NewExport())
	source := `.action{$r := httpGet "https://example.com/weather"}.action{if $r.ok}.action{$r.body}.action{else}offline: .action{$r.error}.action{end}`
	path := writeTemplateDocTreeTestFile(t, source)
	calls := 0
	execution := templatehttp.New(context.Background(), "document", func(context.Context, templatehttp.Request) bool { calls++; return false })
	defer execution.Close()
	_, dom, _, err := RenderTemplateWithHTTP(path, fixture.childID, TemplateRenderModePreview, &source, execution)
	if err != nil || calls != 1 || !strings.Contains(dom, "offline: denied") {
		t.Fatalf("fallback mismatch: calls=%d dom=%s err=%v", calls, dom, err)
	}
	execution.Close()
	_, dom, _, err = RenderTemplateWithHTTP(path, fixture.childID, TemplateRenderModePreview, &source, execution)
	if err == nil || dom != "" || calls != 1 {
		t.Fatal("canceled render escaped or restarted")
	}
}

func TestTemplateHTTPDocumentParseErrorRedactsSecrets(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.Editor.Store(conf.NewEditor())
	Conf.Export.Store(conf.NewExport())
	source := `.action{httpGet "https://example.com/?secret=private" | unknownHTTPFunction}`
	path := writeTemplateDocTreeTestFile(t, source)
	execution := templatehttp.New(context.Background(), "document", nil)
	defer execution.Close()
	_, _, _, err := RenderTemplateWithHTTP(path, fixture.childID, TemplateRenderModePreview, &source, execution)
	if err == nil || strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "unknownHTTPFunction") {
		t.Fatalf("template leaked source: %v", err)
	}
}

func TestTemplateHTTPChildCancellationAndSecretRedaction(t *testing.T) {
	for _, canceled := range []bool{false, true} {
		t.Run(map[bool]string{false: "parse", true: "cancel"}[canceled], func(t *testing.T) {
			fixture := setupFileOperationTest(t)
			clearTemplateDocTreePlansForTest()
			t.Cleanup(clearTemplateDocTreePlansForTest)
			path := writeTemplateDocTreeTestFile(t, `.action{createDocTree (list (dict "title" "Child" "template" "child.md"))}`)
			child := `.action{httpGet "https://example.com/?key=private" | unknownFunction}`
			if canceled {
				child = `.action{(httpGet "https://example.com/weather").body}after cancellation`
			}
			if err := os.WriteFile(filepath.Join(filepath.Dir(path), "child.md"), []byte(child), 0644); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			execution := templatehttp.New(ctx, "document", func(context.Context, templatehttp.Request) bool { cancel(); return false })
			defer execution.Close()
			tree, dom, plan, err := RenderTemplateWithHTTP(path, fixture.sourceID, TemplateRenderModeEditorInsert, nil, execution)
			if err == nil || strings.Contains(err.Error(), "private") || dom != "" || plan != nil || templateDocTreePlanCountForTest() != 0 {
				t.Fatalf("invalid child escaped: tree=%v dom=%q plan=%v err=%v", tree, dom, plan, err)
			}
		})
	}
}
