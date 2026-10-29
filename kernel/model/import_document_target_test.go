// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestRemapImportedDocumentTarget(t *testing.T) {
	const source, destination = "20261023090000-source1", "20261023090001-target1"
	const doc, newDoc = "20261023090002-documen", "20261023090003-documen"
	const external, newExternal = "20261023090004-extern1", "20261023090005-extern2"
	for _, kind := range []string{"notebookRoot", "context", "document"} {
		t.Run(kind, func(t *testing.T) {
			target := &conf.DocumentTarget{Version: 2, Notebook: source, Anchor: conf.DocumentTargetAnchor{Kind: kind},
				Parents: []string{source}, Title: doc, OnMissingParent: "error"}
			if kind == "document" {
				target.Anchor.ID = doc
			}
			result := remapImportedDocumentTarget(target, source, destination, map[string]string{doc: newDoc})
			if err := result.Validate(); err != nil || result.Notebook != destination || result.Title != doc ||
				!reflect.DeepEqual(result.Parents, target.Parents) {
				t.Fatal("target lost its template or notebook identity", result, err)
			}
			if kind == "document" && result.Anchor.ID != newDoc {
				t.Fatal("anchor still points to the source document", result)
			}
			result.Parents[0] = "changed"
			if target.Notebook != source || target.Parents[0] != source || kind == "document" && target.Anchor.ID != doc {
				t.Fatal("import changed the source target")
			}
		})
	}
	target := &conf.DocumentTarget{Notebook: external, Anchor: conf.DocumentTargetAnchor{Kind: "document", ID: external}}
	if result := remapImportedDocumentTarget(target, source, destination, nil); result.Notebook != external || result.Anchor.ID != external {
		t.Fatal("an external target was moved into the imported notebook")
	}
	if result := remapImportedDocumentTarget(target, source, destination, map[string]string{external: newExternal}); result.Notebook != newExternal || result.Anchor.ID != newExternal {
		t.Fatal("shared notebook identities were not remapped")
	}
	target.Notebook, target.Anchor.ID = source, source
	if result := remapImportedDocumentTarget(target, source, destination, nil); result.Notebook != destination || result.Anchor.ID != destination {
		t.Fatal("notebook document identity was not remapped")
	}
	if remapImportedDocumentTarget(nil, source, destination, nil) != nil {
		t.Fatal("an absent target became configured")
	}
}
