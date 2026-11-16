// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"testing"
)

func TestPruneListMindmapRelationGeometry(t *testing.T) {
	for _, version := range []string{"1", "2"} {
		for _, style := range []string{"auto", "straight", "bezier", "rounded"} {
			for _, stroke := range []string{"solid", "dashed", "long-dashed", "dotted"} {
				_, list, _ := mindmapTestTree()
				relation := `{"id":"keep","from":"` + list.ID + `","to":"child","label":"keep","dash":false,` +
					`"pathStyle":"` + style + `","strokeStyle":"` + stroke + `",` +
					`"curve":{"version":1,"from":{"x":40,"y":-20},"to":{"x":-35,"y":60},"extension":9007199254740993},` +
					`"freeRoute":{"version":1,"points":[{"x":5,"y":10,"t":0.5}]},` +
					`"route":{"version":1,"points":[{"x":-35,"y":20.5,"t":0.5}]}}`
				original := `{"version":` + version + `,"nodes":{"child":{},"deleted":{}},"relations":[` + relation + `]}`
				list.SetIALAttr(listMindmapMetadataAttr, original)
				next, changed := pruneListMindmapMetadata(list)
				if !changed || strings.Contains(next, "deleted") || !strings.Contains(next, relation) {
					t.Fatalf("relation geometry changed while pruning nodes: %s", next)
				}
				list.SetIALAttr(listMindmapMetadataAttr, next)
				if again, changed := pruneListMindmapMetadata(list); changed || again != next {
					t.Fatal("relation normalization is not idempotent")
				}
			}
		}
	}
}

func TestPruneListMindmapPreservesInvalidRelationGeometry(t *testing.T) {
	for _, field := range []string{
		`"pathStyle":null`, `"pathStyle":"future"`, `"strokeStyle":false`, `"strokeStyle":"future"`,
		`"curve":null`, `"curve":{"version":2,"from":{"x":0,"y":0},"to":{"x":0,"y":0}}`,
		`"curve":{"version":1,"from":{"x":0,"y":0}}`,
		`"curve":{"version":1,"from":{"x":1000001,"y":0},"to":{"x":0,"y":0}}`,
		`"curve":{"version":1,"from":{"x":0,"y":null},"to":{"x":0,"y":0}}`,
		`"freeRoute":null`, `"freeRoute":{"version":1,"points":[]}`,
	} {
		_, list, _ := mindmapTestTree()
		original := `{"version":1,"nodes":{"deleted":{}},"relations":[{"id":"r","from":"a","to":"b","label":"",` + field + `}]}`
		list.SetIALAttr(listMindmapMetadataAttr, original)
		if next, changed := pruneListMindmapMetadata(list); changed || next != original {
			t.Fatalf("invalid geometry was overwritten: %s", next)
		}
	}
}
