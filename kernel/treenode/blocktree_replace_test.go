package treenode

import "testing"

func TestReplaceBlockTreeIsAtomicAndReportsFailure(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "insert-failure"}[fail], func(t *testing.T) {
			box := withDocumentMetadataDB(t, false)
			tree := NewTree(box, "/20261026000000-root001.sy", "/Original", "Original")
			if err := ReplaceBlockTree(tree); err != nil {
				t.Fatal(err)
			}
			oldID := tree.Root.FirstChild.ID
			const replacement = "20261026000001-new0001"
			tree.Root.FirstChild.ID = replacement
			tree.Root.FirstChild.SetIALAttr("id", replacement)
			if fail {
				if _, err := db.Exec("CREATE TRIGGER fail_repair BEFORE INSERT ON blocktrees WHEN NEW.id = '" + replacement + "' BEGIN SELECT RAISE(ABORT, 'injected block-tree failure'); END"); err != nil {
					t.Fatal(err)
				}
			}
			err := ReplaceBlockTree(tree)
			if (err != nil) != fail {
				t.Fatalf("replace failure was not reported: %v", err)
			}
			if (GetBlockTreeInExactBox(oldID, box) != nil) != fail || (GetBlockTreeInExactBox(replacement, box) != nil) == fail {
				t.Fatal("replacement did not publish or roll back its complete identity set")
			}
			if root := GetBlockTreeInExactBox(tree.ID, box); root == nil || root.Path != tree.Path {
				t.Fatal("replacement lost the document identity")
			}
		})
	}
}
