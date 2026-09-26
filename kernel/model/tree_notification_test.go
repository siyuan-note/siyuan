package model

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/time/rate"
)

func TestClosedBoxNotification(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		clearClosedBoxNotification("first")
		clearClosedBoxNotification("second")
		util.DataDir = originalDataDir
	})
	var count atomic.Int32
	var group sync.WaitGroup
	for i := 0; i < 32; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			if markClosedBoxNotification("first") {
				count.Add(1)
			}
		}()
	}
	group.Wait()
	if count.Load() != 1 {
		t.Fatalf("concurrent requests produced %d notifications", count.Load())
	}
	if !markClosedBoxNotification("second") {
		t.Fatal("another notebook must have its own notification")
	}
	clearClosedBoxNotification("first")
	if !markClosedBoxNotification("first") || markClosedBoxNotification("first") {
		t.Fatal("reopening must allow exactly one new notification")
	}
	if markClosedBoxNotification("second") {
		t.Fatal("reopening one notebook reset another notebook")
	}
	workspace := util.DataDir
	util.DataDir = filepath.Join(workspace, "another-workspace")
	if !markClosedBoxNotification("first") {
		t.Fatal("another workspace must have its own notification")
	}
	clearClosedBoxNotification("first")
	util.DataDir = workspace
}

func TestClosedBoxRepeatedLookupPreservesError(t *testing.T) {
	// 独立进程隔离其他用例遗留的索引任务，保留真实请求入口的索引状态检查。
	const subprocessEnv = "SIYUAN_TEST_CLOSED_BOX_LOOKUP"
	if os.Getenv(subprocessEnv) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestClosedBoxRepeatedLookupPreservesError$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), subprocessEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("closed notebook lookup subprocess failed: %v\n%s", err, output)
		}
		return
	}

	fixture := setupFileOperationTest(t)
	originalLimiter := searchTreeLimiter
	searchTreeLimiter = rate.NewLimiter(rate.Inf, 1)
	t.Cleanup(func() {
		searchTreeLimiter = originalLimiter
		clearClosedBoxNotification(fixture.box.ID)
	})
	boxConf := fixture.box.GetConf()
	boxConf.Closed = true
	if err := fixture.box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	treenode.RemoveBlockTreesByBoxID(fixture.box.ID)
	for _, id := range []string{fixture.sourceID, fixture.targetID, fixture.sourceID} {
		if err := ReindexMissingNormalBlock(id); !errors.Is(err, ErrBoxUnindexed) {
			t.Fatalf("lookup %s returned %v", id, err)
		}
		if treenode.GetBlockTree(id) != nil {
			t.Fatal("closed notebook was indexed")
		}
	}
	if markClosedBoxNotification(fixture.box.ID) {
		t.Fatal("lookup did not record the notebook notification")
	}
	boxConf.Closed = false
	if err := fixture.box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if mounted, err := mountBox(fixture.box.ID); err != nil || !mounted {
		t.Fatalf("open notebook: mounted=%v err=%v", mounted, err)
	}
	if !markClosedBoxNotification(fixture.box.ID) {
		t.Fatal("opening the notebook did not reset its notification")
	}
}
