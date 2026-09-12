// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import "testing"

func TestSplitFileAnnotationRef(t *testing.T) {
	const id = "20260912000000-abcdefg"
	for _, asset := range []string{"assets/a.pdf", "assets/文档.PDF", "assets/folder/a%20b.pdf",
		"assets/a-20260912000001-abcdefg.pdf", "/assets/document.pdf"} {
		for _, suffix := range []string{"", "?box=20260912000001-hijklmn&dataPath=/docs/a.sy", "?dataPath=%2Fa%20b.sy#view"} {
			gotAsset, gotID := SplitFileAnnotationRef(asset + "/" + id + suffix)
			if gotAsset != asset+suffix || gotID != id {
				t.Fatalf("split annotation: got %q, %q; want %q, %q", gotAsset, gotID, asset+suffix, id)
			}
		}
	}
	for _, reference := range []string{"", "assets/a.pdf", "assets/a.txt/" + id, "assets/a.pdf/not-an-id",
		"assets/a.pdf/" + id + "/extra"} {
		if asset, id := SplitFileAnnotationRef(reference); asset != "" || id != "" {
			t.Errorf("accepted invalid reference %q", reference)
		}
	}
}
