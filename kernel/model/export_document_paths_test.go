// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"path"
	"reflect"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestExportDocumentPathsPreserveIdentityAndHierarchy(t *testing.T) {
	root := exportDocumentIdentity{box: "box"}
	a := exportDocumentIdentity{"box", "20261023090000-aaaaaaa"}
	b := exportDocumentIdentity{"box", "20261023090000-bbbbbbb"}
	c := exportDocumentIdentity{"box", "20261023090000-ccccccc"}
	d := exportDocumentIdentity{"box", "20261023090000-ddddddd"}
	e := exportDocumentIdentity{"box", "20261023090000-eeeeeee"}
	nodes := []exportDocumentLocation{{a, root, "Parent"}, {b, root, "parent"}, {c, b, "A/B"}, {d, root, "Parent.md"}, {e, root, "assets"}}
	paths, err := allocateExportDocumentPaths(nodes, nil, ".md")
	if err != nil {
		t.Fatal(err)
	}
	if paths[a] != "/Parent.md" || paths[b] == paths[a] || strings.Count(paths[c], "/") != 2 ||
		path.Dir(paths[c]) != strings.TrimSuffix(paths[b], ".md") || strings.TrimSuffix(paths[d], ".md") == paths[a] ||
		paths[e] == "/assets.md" {
		t.Fatalf("identity, hierarchy, or reserved directory lost: %#v", paths)
	}
	seen := map[string]bool{}
	for _, filename := range paths {
		key := exportPathComparison(filename)
		if seen[key] {
			t.Fatal("case-insensitive collision", paths)
		}
		seen[key] = true
	}
	slices.Reverse(nodes)
	reversed, err := allocateExportDocumentPaths(nodes, nil, ".md")
	if err != nil || !reflect.DeepEqual(paths, reversed) {
		t.Fatalf("export order changed allocation: %#v, %v", reversed, err)
	}
}

func TestExportDocumentFileNames(t *testing.T) {
	for _, title := range []string{"", ".", "..", "CON", "con.txt", "LPT1", "COM¹", "LPT².txt", "A/../B", `A\B:*?"<>|`, "end. ", strings.Repeat("界", 200)} {
		name := exportDocumentFileName(title, "20261023090000-aaaaaaa")
		if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\:*?"<>|`) ||
			strings.TrimRight(name, ". ") != name || len(name) > 121 || !utf8.ValidString(name) {
			t.Fatalf("unsafe filename for %q: %q", title, name)
		}
	}
	for _, title := range []string{"CON", "COM1", "COM¹", "LPT².txt"} {
		if !strings.HasPrefix(exportDocumentFileName(title, "id"), "_") {
			t.Fatal("reserved Windows filename was not escaped", title)
		}
	}
	if exportPathComparison("e\u0301") != exportPathComparison("É") || exportPathComparison("ſ") != exportPathComparison("S") {
		t.Fatal("filesystem-equivalent names must share collision keys")
	}
}
