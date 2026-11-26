// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestListDocTreeHydratesSelectedDocuments(t *testing.T) {
	fixture := setupFileOperationTest(t)
	addFileOperationTestDoc(t, fixture, "20260718000003-abcdefg", "AAA hidden", true)
	childPath := strings.TrimSuffix(fixture.targetPath, ".sy") + "/20260718000004-abcdefg.sy"
	child := treenode.NewTree(fixture.box.ID, childPath, "/Target/Child", "Child")
	if _, err := filesys.WriteTree(child); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cache.RemoveDocIALInBox(child.Path, fixture.box.ID) })
	for _, scenario := range []struct {
		mode int
		id   string
		kids int
	}{
		{util.SortModeNameASC, fixture.sourceID, 0},
		{util.SortModeNameDESC, fixture.targetID, 1},
		{util.SortModeSubDocCountDESC, fixture.targetID, 1},
	} {
		page, total, err := ListDocTree(fixture.box.ID, "/", scenario.mode, false, false, 1)
		if err != nil || total != 2 || len(page) != 1 || page[0].ID != scenario.id || page[0].SubFileCount != scenario.kids {
			t.Fatalf("mode %d: total=%d, page=%+v, error=%v", scenario.mode, total, page, err)
		}
		file := page[0]
		path := file.Path
		full := fixture.box.docFromFileInfo(fixture.box.Stat(path), fixture.box.docIAL(path))
		if file.TitleRevision == "" || file.TitleFormat != full.TitleFormat || file.TitleRevision != full.TitleRevision ||
			file.HMtime != full.HMtime || file.HCtime != full.HCtime || file.HSize != full.HSize {
			t.Fatalf("listed document was not fully hydrated: %+v, want display fields from %+v", file, full)
		}
	}
}
