// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"errors"
	"strings"
	"testing"

	"github.com/88250/lute/parse"
)

func TestLegacyDocumentCandidatesClassifyRealAncestorChains(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box := withDocumentMetadataDB(t, encrypted)
			parent := NewTree(box, "/20261026000001-parent1.sy", "/A", "A")
			clean := NewTree(box, "/20261026000001-parent1/20261026000002-clean01.sy", "/A/B", "B")
			slash := NewTree(box, "/20261026000003-slash01.sy", "/A/B", "A/B")
			leaf := NewTree(box, "/20261026000003-slash01/20261026000004-leaf001.sy", "/A/B/C", "C")
			empty := NewTree(box, "/20261026000001-parent1/20261026000005-empty01.sy", "/A", "")
			placeholder := NewTree(box, "/20261026000006-place01.sy", "/Untitled", "Untitled")
			placeholder.Root.SetIALAttr(DocumentTitleEmptyAttr, "true")
			literal := NewTree(box, "/20261026000007-entity1.sy", "/A&#47;B", "A&#47;B")
			for _, tree := range []*parse.Tree{parent, clean, slash, leaf, empty, placeholder, literal} {
				UpsertBlockTree(tree)
			}
			if _, err := execForBox(box, "UPDATE blocktrees SET hpath='/A' WHERE id=?", empty.ID); err != nil {
				t.Fatal(err)
			}
			if err := SetDocumentMetadataState(box, "ready"); err != nil {
				t.Fatal(err)
			}
			paths := []string{"/A/B", "/A/B/C", "/A", "/Untitled", "/A&#47;B", "/missing"}
			groups, err := ClassifyLegacyDocumentPaths(box, paths)
			if err != nil {
				t.Fatal(err)
			}
			for hp, want := range map[string][2]int{"/A/B": {1, 1}, "/A/B/C": {0, 1}, "/A": {1, 1}, "/Untitled": {0, 1}, "/A&#47;B": {1, 0}, "/missing": {0, 0}} {
				if got := groups[hp]; len(got.Clean) != want[0] || len(got.Unsupported) != want[1] {
					t.Fatalf("%s: %+v", hp, got)
				}
			}
			RemoveBlockTree(box, slash.ID)
			RemoveBlockTree(box, leaf.ID)
			groups, err = ClassifyLegacyDocumentPaths(box, []string{"/A/B"})
			if err != nil || len(groups["/A/B"].Clean) != 1 || len(groups["/A/B"].Unsupported) != 0 {
				t.Fatal(groups, err)
			}
		})
	}
}

func TestLegacyDocumentAncestorReadsUseIdentityIndexes(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box := withDocumentMetadataDB(t, encrypted)
			rows, err := queryForBox(box, "EXPLAIN QUERY PLAN "+legacyAncestorMetadataQuery, "[]", box, box)
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			var plan strings.Builder
			for rows.Next() {
				var id, parent, unused int
				var detail string
				if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
					t.Fatal(err)
				}
				plan.WriteString(detail + "\n")
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(plan.String(), "SEARCH b USING INDEX idx_blocktrees_id (id=?)") || !strings.Contains(plan.String(), "SEARCH m USING INDEX sqlite_autoindex_document_metadata_1 (box_id=? AND id=?)") {
				t.Fatal("ancestor lookup scans unrelated documents", plan.String())
			}
		})
	}
}

func TestLegacyDocumentCandidatesFailClosed(t *testing.T) {
	for _, state := range []string{"missing", "building", "pending", "missing ancestor", "corrupt revision", "stale hpath", "cycle", "database error"} {
		t.Run(state, func(t *testing.T) {
			box := withDocumentMetadataDB(t, false)
			parent := NewTree(box, "/20261026000001-parent1.sy", "/A", "A")
			child := NewTree(box, "/20261026000001-parent1/20261026000002-child01.sy", "/A/B", "B")
			UpsertBlockTree(parent)
			UpsertBlockTree(child)
			if state != "missing" {
				if err := SetDocumentMetadataState(box, "ready"); err != nil {
					t.Fatal(err)
				}
			}
			var err error
			switch state {
			case "building":
				err = SetDocumentMetadataState(box, "building")
			case "pending":
				_, err = BeginDocumentMetadataRecovery(GetBlockTreeInExactBox(parent.ID, box))
			case "missing ancestor":
				_, err = db.Exec("DELETE FROM document_metadata WHERE id=?", parent.ID)
			case "corrupt revision":
				_, err = db.Exec("UPDATE document_metadata SET revision='corrupt' WHERE id=?", parent.ID)
			case "stale hpath":
				_, err = db.Exec("UPDATE blocktrees SET hpath='/old/B' WHERE id=?", child.ID)
			case "cycle":
				parent.Path = "/" + child.ID + "/" + parent.ID + ".sy"
				UpsertBlockTree(parent)
			case "database error":
				err = db.Close()
			}
			if err != nil {
				t.Fatal(err)
			}
			hp := "/A/B"
			if state == "stale hpath" {
				hp = "/old/B"
			}
			if _, err := ClassifyLegacyDocumentPaths(box, []string{hp}); err == nil {
				t.Fatal("unproven chain accepted")
			}
			if state == "pending" {
				if _, err := ClassifyLegacyDocumentPaths(box, []string{"/not-found"}); !errors.Is(err, ErrDocumentMetadataUnavailable) {
					t.Fatal("pending index treated as empty", err)
				}
			}
		})
	}
}

func TestLegacyDocumentCandidatesAfterSourceMetadataCommit(t *testing.T) {
	box := withDocumentMetadataDB(t, false)
	parent := NewTree(box, "/20261026000001-parent1.sy", "/Old", "Old")
	child := NewTree(box, "/20261026000001-parent1/20261026000002-child01.sy", "/Old/C", "C")
	other := NewTree(box, "/20261026000003-other01.sy", "/A", "A")
	otherChild := NewTree(box, "/20261026000003-other01/20261026000004-other02.sy", "/A/B", "B")
	collision := NewTree(box, "/20261026000003-other01/20261026000004-other02/20261026000005-other03.sy", "/A/B/C", "C")
	for _, tree := range []*parse.Tree{parent, child, other, otherChild, collision} {
		UpsertBlockTree(tree)
	}
	if err := SetDocumentMetadataState(box, "ready"); err != nil {
		t.Fatal(err)
	}
	parent.Root.SetIALAttr("title", "A/B")
	parent.HPath = "/A/B"
	if _, err := BeginDocumentMetadataWrite(parent); err != nil {
		t.Fatal(err)
	}
	if err := CommitDocumentMetadataWrite(parent); err != nil {
		t.Fatal(err)
	}
	groups, err := ClassifyLegacyDocumentPaths(box, []string{"/A/B/C"})
	if err != nil || len(groups["/A/B/C"].Clean) != 1 || len(groups["/A/B/C"].Unsupported) != 1 {
		t.Fatal("source metadata commit missed a new collision", groups, err)
	}
}
