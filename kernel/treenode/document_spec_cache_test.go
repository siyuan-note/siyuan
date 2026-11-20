// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"bytes"
	"errors"
	"fmt"
	"testing"

	"github.com/88250/lute/parse"
)

func TestDocumentSourceSpecCacheUsesExactBytes(t *testing.T) {
	options := parse.NewOptions()
	source := []byte(`{"Type":"NodeDocument","ID":"20261120000000-0000001","Spec":"7","Properties":{"title":"Original"}}`)
	first, _, err := ParseJSONWithSpecCache(source, options)
	if err != nil {
		t.Fatal(err)
	}
	documentSpecCache.Wait()

	first.Root.SetIALAttr("title", "Memory only")
	again, _, err := ParseJSONWithSpecCache(source, options)
	if err != nil || again.Root.IALAttr("title") != "Original" {
		t.Fatalf("same source must produce an independent tree: %v, %v", again, err)
	}
	changed := bytes.Replace(source, []byte("Original"), []byte("Changed"), 1)
	next, _, err := ParseJSONWithSpecCache(changed, options)
	if err != nil || next.Root.IALAttr("title") != "Changed" {
		t.Fatalf("changed source must be parsed: %v, %v", next, err)
	}
	unsupported := bytes.Replace(source, []byte(`"Spec":"7"`), []byte(`"Spec":"999","Spec":"7"`), 1)
	if _, _, err := ParseJSONWithSpecCache(unsupported, options); !errors.Is(err, ErrSpecTooNew) {
		t.Fatalf("unsupported source hidden by a duplicate spec: %v", err)
	}
}

func BenchmarkDocumentSourceSpecCache(b *testing.B) {
	options := parse.NewOptions()
	const paragraph = `{"Type":"NodeParagraph","Children":[{"Type":"NodeText","Data":"A paragraph in a document linked to the database"}]},`
	children := bytes.TrimSuffix(bytes.Repeat([]byte(paragraph), 60), []byte(","))
	sources := make([][]byte, 177)
	for i := range sources {
		sources[i] = fmt.Appendf(nil, `{"Type":"NodeDocument","ID":"20261120000000-%07d","Spec":"7","Children":[%s]}`, i, children)
	}
	for _, tc := range []struct {
		name  string
		parse func([]byte, *parse.Options) (*parse.Tree, bool, error)
	}{
		{"validate", ParseJSON},
		{"reuse", ParseJSONWithSpecCache},
	} {
		b.Run(tc.name, func(b *testing.B) {
			for _, source := range sources {
				if _, _, err := tc.parse(source, options); err != nil {
					b.Fatal(err)
				}
			}
			documentSpecCache.Wait()
			b.ResetTimer()
			for b.Loop() {
				for _, source := range sources {
					if _, _, err := tc.parse(source, options); err != nil {
						b.Fatal(err)
					}
				}
			}
		})
	}
}
