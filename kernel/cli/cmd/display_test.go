// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import "testing"

func TestResolvePath(t *testing.T) {
	paths := map[string]string{
		"/parent":       "/20260827000000-parent1.sy",
		"/parent/child": "/20260827000000-parent1/20260827000001-child01.sy",
	}
	lookup := func(hPath string) (string, bool) {
		p, found := paths[hPath]
		return p, found
	}
	tests := []struct {
		name     string
		userPath string
		hPath    string
		want     string
		wantErr  bool
	}{
		{name: "explicit internal path", userPath: "/explicit.sy", hPath: "/missing", want: "/explicit.sy"},
		{name: "default root", want: "/"},
		{name: "root hpath", hPath: "/", want: "/"},
		{name: "relative root hpath", hPath: ".", want: "/"},
		{name: "existing hpath", hPath: "/parent", want: "/20260827000000-parent1.sy"},
		{name: "relative hpath", hPath: "parent", want: "/20260827000000-parent1.sy"},
		{name: "hpath with trailing slash", hPath: "/parent/", want: "/20260827000000-parent1.sy"},
		{
			name:  "nested hpath",
			hPath: "/parent/child",
			want:  "/20260827000000-parent1/20260827000001-child01.sy",
		},
		{name: "missing hpath", hPath: "/missing", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := resolvePathWithLookup(test.userPath, test.hPath, lookup)
			if test.wantErr {
				if nil == err {
					t.Fatalf("expected an error, got path %q", got)
				}
				return
			}
			if nil != err {
				t.Fatalf("resolve path failed: %v", err)
			}
			if got != test.want {
				t.Fatalf("unexpected path: got %q, want %q", got, test.want)
			}
		})
	}
}

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
		sourceTitle string
		want        string
		wantErr     bool
	}{
		{
			name:        "explicit internal path",
			userPath:    "/20260726000000-parent1.sy",
			hPath:       "/missing",
			sourceTitle: "child",
			want:        "/20260726000000-parent1.sy",
		},
		{name: "default root", sourceTitle: "child", want: "/"},
		{name: "root hpath", hPath: "/", sourceTitle: "child", want: "/"},
		{
			name:        "parent hpath",
			hPath:       "/parent",
			sourceTitle: "child",
			want:        "/20260726000000-parent1.sy",
		},
		{
			name:        "parent hpath with trailing slash",
			hPath:       "/parent/",
			sourceTitle: "child",
			want:        "/20260726000000-parent1.sy",
		},
		{
			name:        "full destination hpath",
			hPath:       "/parent/child",
			sourceTitle: "child",
			want:        "/20260726000000-parent1.sy",
		},
		{
			name:        "nested full destination hpath",
			hPath:       "/grand/parent/child",
			sourceTitle: "child",
			want:        "/20260726000000-grand01/20260726000001-parent1.sy",
		},
		{
			name:        "existing target with different source title",
			hPath:       "/existing/child",
			sourceTitle: "source",
			want:        "/20260726000002-existin/20260726000003-child01.sy",
		},
		{name: "missing target", hPath: "/missing", sourceTitle: "child", wantErr: true},
		{name: "missing destination parent", hPath: "/missing/child", sourceTitle: "child", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := resolveDocumentMovePathWithLookup(test.userPath, test.hPath, test.sourceTitle, lookup)
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
