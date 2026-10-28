// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
)

func TestTableCellRichLivePhotoRoundTrip(t *testing.T) {
	rich := &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: `![photo](assets/photo.heic){: custom-sy-live-photo="1" custom-sy-live-photo-video="assets/photo.mov?x=1&y=2"}`}
	for range 3 {
		tree, err := ParseTableCellRich(rich)
		if err != nil {
			t.Fatal(err)
		}
		content, err := RenderTableCellRich(tree)
		if err != nil || !strings.Contains(content, "custom-sy-live-photo-video") {
			t.Fatalf("lost video association: %s, %v", content, err)
		}
		rich.Content = content
	}
	for _, path := range []string{"javascript:alert(1)", "assets/../private.mov", "https://example.com/photo.mov"} {
		unsafe := &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: `![photo](assets/photo.heic){: custom-sy-live-photo="1" custom-sy-live-photo-video="` + path + `"}`}
		if _, err := ParseTableCellRich(unsafe); err == nil {
			t.Fatalf("accepted unsafe video path: %s", path)
		}
	}
}
