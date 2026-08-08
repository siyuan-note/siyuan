// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package cmd

import "testing"

func TestResolveDocumentMovePath(t *testing.T) {
	paths := map[string]string{
		"/parent":         "/20260726000000-parent1.sy",
		"/grand/parent":   "/20260726000000-grand01/20260726000001-parent1.sy",
		"/existing/child": "/20260726000002-existin/20260726000003-child01.sy",
	}
	lookup := func(hPath string) (string, bool) {
		p, found := paths[hPath]
		return p, found
	}
	tests := []struct {
		name        string
		userPath    string
		hPath       string
		sourceHPath string
		want        string
		wantErr     bool
	}{
		{
			name:        "explicit internal path",
			userPath:    "/20260726000000-parent1.sy",
			hPath:       "/missing",
			sourceHPath: "/child",
			want:        "/20260726000000-parent1.sy",
		},
		{name: "default root", sourceHPath: "/child", want: "/"},
		{name: "root hpath", hPath: "/", sourceHPath: "/child", want: "/"},
		{
			name:        "parent hpath",
			hPath:       "/parent",
			sourceHPath: "/child",
			want:        "/20260726000000-parent1.sy",
		},
		{
			name:        "parent hpath with trailing slash",
			hPath:       "/parent/",
			sourceHPath: "/child",
			want:        "/20260726000000-parent1.sy",
		},
		{
			name:        "full destination hpath",
			hPath:       "/parent/child",
			sourceHPath: "/child",
			want:        "/20260726000000-parent1.sy",
		},
		{
			name:        "nested full destination hpath",
			hPath:       "/grand/parent/child",
			sourceHPath: "/child",
			want:        "/20260726000000-grand01/20260726000001-parent1.sy",
		},
		{
			name:        "existing target with different source title",
			hPath:       "/existing/child",
			sourceHPath: "/source",
			want:        "/20260726000002-existin/20260726000003-child01.sy",
		},
		{name: "missing target", hPath: "/missing", sourceHPath: "/child", wantErr: true},
		{name: "missing destination parent", hPath: "/missing/child", sourceHPath: "/child", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := resolveDocumentMovePathWithLookup(test.userPath, test.hPath, test.sourceHPath, lookup)
			if test.wantErr {
				if nil == err {
					t.Fatalf("expected an error, got path %q", got)
				}
				return
			}
			if nil != err {
				t.Fatalf("resolve document move path failed: %v", err)
			}
			if got != test.want {
				t.Fatalf("unexpected document move path: got %q, want %q", got, test.want)
			}
		})
	}
}

func TestNormalizeDocumentCreateParentPath(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{name: "default root", path: "", want: "/"},
		{name: "root", path: "/", want: "/"},
		{name: "document directory", path: "/20260726000000-abcdefg", want: "/20260726000000-abcdefg"},
		{name: "document file", path: "/20260726000000-abcdefg.sy", want: "/20260726000000-abcdefg"},
		{
			name: "nested document file",
			path: "/20260726000000-abcdefg/20260726000001-abcdefg.sy",
			want: "/20260726000000-abcdefg/20260726000001-abcdefg",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeDocumentCreateParentPath(test.path); got != test.want {
				t.Fatalf("normalizeDocumentCreateParentPath(%q) = %q, want %q", test.path, got, test.want)
			}
		})
	}
}

func TestDocumentSearchDisplayFields(t *testing.T) {
	tests := []struct {
		name     string
		doc      map[string]string
		wantType string
		wantID   string
		wantName string
	}{
		{
			name: "document",
			doc: map[string]string{
				"path":  "/20260722120000-parent1/20260722123000-child01.sy",
				"hPath": "Notebook/Parent/Document",
				"box":   "20260722110000-boxid01",
			},
			wantType: "DOCUMENT",
			wantID:   "20260722123000-child01",
			wantName: "Document",
		},
		{
			name: "notebook",
			doc: map[string]string{
				"path":  "/",
				"hPath": "Notebook/",
				"box":   "20260722110000-boxid01",
			},
			wantType: "NOTEBOOK",
			wantID:   "20260722110000-boxid01",
			wantName: "Notebook",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			typ, id, name := documentSearchDisplayFields(test.doc)
			if typ != test.wantType || id != test.wantID || name != test.wantName {
				t.Fatalf("documentSearchDisplayFields() = (%q, %q, %q), want (%q, %q, %q)", typ, id, name, test.wantType, test.wantID, test.wantName)
			}
		})
	}
}

func TestTruncate(t *testing.T) {
	tests := []struct {
		name   string
		value  string
		length int
		want   string
	}{
		{name: "ascii unchanged", value: "SiYuan", length: 6, want: "SiYuan"},
		{name: "ascii truncated", value: "SiYuan", length: 2, want: "Si..."},
		{name: "Chinese unchanged", value: "思源笔记", length: 4, want: "思源笔记"},
		{name: "Chinese truncated", value: "思源笔记", length: 2, want: "思源..."},
		{name: "mixed", value: "SiYuan思源", length: 7, want: "SiYuan思..."},
		{name: "zero", value: "SiYuan", length: 0, want: "..."},
		{name: "empty", value: "", length: 0, want: ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := truncate(test.value, test.length); got != test.want {
				t.Fatalf("truncate(%q, %d) = %q, want %q", test.value, test.length, got, test.want)
			}
		})
	}
}
