package model

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupSyncMutationTest(t *testing.T) {
	t.Helper()
	oldConf, oldDataDir, oldSnippetsPath := Conf, util.DataDir, util.SnippetsPath
	oldAccess, oldAccessModified := publishAccess, publishAccessLastModified
	oldCount := syncSameCount.Load()
	syncPlanTimeLock.Lock()
	oldPlan := syncPlanTime
	syncPlanTimeLock.Unlock()
	Conf, util.DataDir = NewAppConf(), t.TempDir()
	Conf.Sync = conf.NewSync()
	util.SnippetsPath = filepath.Join(util.DataDir, "snippets")
	t.Cleanup(func() {
		pendingSync.mu.Lock()
		if pendingSync.timer != nil {
			pendingSync.timer.Stop()
			pendingSync.timer = nil
		}
		pendingSync.pending = false
		pendingSync.mu.Unlock()
		Conf, util.DataDir, util.SnippetsPath = oldConf, oldDataDir, oldSnippetsPath
		publishAccess, publishAccessLastModified = oldAccess, oldAccessModified
		syncSameCount.Store(oldCount)
		syncPlanTimeLock.Lock()
		syncPlanTime = oldPlan
		syncPlanTimeLock.Unlock()
	})
}

func assertSyncMutation(t *testing.T, want bool, mutate func() error) {
	t.Helper()
	syncSameCount.Store(10)
	planSyncAfter(1024 * time.Minute)
	revision := pendingSync.begin()
	if err := mutate(); err != nil {
		t.Fatal(err)
	}
	changed := pendingSync.begin() != revision
	if changed != want {
		t.Fatalf("sync notification = %v, want %v", changed, want)
	}
	pendingSync.mu.Lock()
	pending := pendingSync.pending
	pendingSync.mu.Unlock()
	if want && !pending {
		t.Fatal("mutation did not mark pending sync")
	}
	syncPlanTimeLock.Lock()
	delay := time.Until(syncPlanTime)
	syncPlanTimeLock.Unlock()
	if want && (syncSameCount.Load() != 0 || delay > time.Duration(Conf.Sync.Interval)*time.Second) {
		t.Fatalf("mutation did not reset backoff: count=%d, delay=%v", syncSameCount.Load(), delay)
	}
	if !want && (syncSameCount.Load() != 10 || delay < 1000*time.Minute) {
		t.Fatal("non-synced operation changed the sync plan")
	}
}

func TestSyncedDataMutations(t *testing.T) {
	for _, ignored := range []bool{false, true} {
		name := "included"
		if ignored {
			name = "ignored"
		}
		t.Run(name, func(t *testing.T) {
			setupSyncMutationTest(t)
			if err := os.MkdirAll(filepath.Join(util.DataDir, "templates"), 0755); err != nil {
				t.Fatal(err)
			}
			if ignored {
				p := filepath.Join(util.DataDir, ".siyuan", "syncignore")
				if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(p, []byte("/snippets/**\n/storage/**\n/templates/**\n/.siyuan/publishAccess.json\n"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			for _, test := range []struct {
				name   string
				mutate func() error
			}{
				{"set snippet", func() error { return SetSnippet([]*conf.Snippet{{ID: "test"}}) }},
				{"remove snippet", func() error { _, err := RemoveSnippet("test"); return err }},
				{"set criterion", func() error { return SetCriterion(&Criterion{Name: "test"}) }},
				{"remove criterion", func() error { return RemoveCriterion("test") }},
				{"create template", func() error { _, err := CreateTemplate("test", "content", false); return err }},
				{"publish access", func() error { return SetPublishAccess(PublishAccess{}) }},
				{"plugin configuration", func() error {
					_, err := updatePetal("test", func(p *Petal) error { p.Enabled = true; return nil })
					return err
				}},
			} {
				t.Run(test.name, func(t *testing.T) { assertSyncMutation(t, !ignored, test.mutate) })
			}
		})
	}
}

func TestSyncMutationReadAndFailure(t *testing.T) {
	setupSyncMutationTest(t)
	assertSyncMutation(t, false, func() error { GetPublishAccess(); getPetals(); _, err := LoadSnippets(); return err })
	assertSyncMutation(t, false, func() error {
		if _, err := CreateTemplate("blocked", "content", true); err == nil {
			t.Fatal("expected template write failure")
		}
		return nil
	})
	if err := os.MkdirAll(filepath.Join(util.DataDir, "templates", "blocked.md"), 0755); err != nil {
		t.Fatal(err)
	}
	assertSyncMutation(t, false, func() error {
		code, err := CreateTemplate("blocked", "content", false)
		if code != 1 {
			t.Fatalf("code = %d", code)
		}
		return err
	})
}

func TestNotebookConfSyncMutation(t *testing.T) {
	setupSyncMutationTest(t)
	box := &Box{ID: "20260919120000-abcdefg"}
	boxConf := &conf.BoxConf{Name: "test"}
	assertSyncMutation(t, false, func() error { return box.SaveConf(boxConf) })
	boxConf.Closed = true
	assertSyncMutation(t, true, func() error { return box.SaveConfAndSync(boxConf) })
	assertSyncMutation(t, false, func() error { return box.SaveConfAndSync(boxConf) })
}

func TestPackageRemovalSyncMutation(t *testing.T) {
	for _, ignored := range []bool{false, true} {
		t.Run(map[bool]string{false: "included", true: "ignored"}[ignored], func(t *testing.T) {
			setupSyncMutationTest(t)
			packagePath := filepath.Join(util.DataDir, "templates", "sample")
			writeSyncPathTestFile(t, filepath.Join(packagePath, "test.md"))
			if err := os.WriteFile(filepath.Join(packagePath, "template.json"), []byte(`{"name":"sample","version":"1.0.0"}`), 0644); err != nil {
				t.Fatal(err)
			}
			if ignored {
				ignorePath := filepath.Join(util.DataDir, ".siyuan", "syncignore")
				writeSyncPathTestFile(t, ignorePath)
				if err := os.WriteFile(ignorePath, []byte("/templates/sample/**\n"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			assertSyncMutation(t, !ignored, func() error { return UninstallPackage("templates", "sample") })
			if _, err := os.Stat(packagePath); !os.IsNotExist(err) {
				t.Fatalf("package was not removed: %v", err)
			}
		})
	}
}

func TestFlashcardDeckSyncMutation(t *testing.T) {
	setupSyncMutationTest(t)
	Conf.Flashcard = conf.NewFlashcard()
	oldDecks := Decks
	Decks = map[string]*riff.Deck{}
	t.Cleanup(func() { Decks = oldDecks })
	var deck *riff.Deck
	assertSyncMutation(t, true, func() (err error) { deck, err = CreateDeck("test"); return })
	assertSyncMutation(t, true, func() error { return RenameDeck(deck.ID, "renamed") })
	assertSyncMutation(t, false, func() error { return SkipReviewFlashcard(deck.ID, "missing") })
	assertSyncMutation(t, true, func() error { return RemoveDeck(deck.ID) })
	assertSyncMutation(t, false, func() error { return RemoveDeck(deck.ID) })
	if _, err := createDeck0("builtin", builtinDeckID); err != nil {
		t.Fatal(err)
	}
	assertSyncMutation(t, true, func() error { return SetFlashcardsDueTime(nil) })
}

func TestFlashcardReviewSyncAfterLogFailure(t *testing.T) {
	setupSyncMutationTest(t)
	Conf.Flashcard = conf.NewFlashcard()
	oldDecks, oldReviews, oldSkipped := Decks, reviewCardCache, skipCardCache
	Decks, reviewCardCache, skipCardCache = map[string]*riff.Deck{}, map[string]riff.Card{}, map[string]riff.Card{}
	oldDBPath := util.BlockTreeDBPath
	util.BlockTreeDBPath = filepath.Join(t.TempDir(), "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		Decks, reviewCardCache, skipCardCache = oldDecks, oldReviews, oldSkipped
		treenode.CloseDatabase()
		util.BlockTreeDBPath = oldDBPath
		if oldDBPath != "" {
			treenode.InitBlockTree(false)
		}
	})
	const blockID = "20260919120001-abcdefg"
	tree := newDocBlocksOrdersTestTree("20260919120000-abcdefg", "20260919120002-abcdefg", []string{blockID})
	treenode.IndexBlockTree(tree)
	deck, err := createDeck0("test", builtinDeckID)
	if err != nil {
		t.Fatal(err)
	}
	const cardID = "20260919120003-abcdefg"
	deck.AddCard(cardID, blockID)
	if err = os.WriteFile(filepath.Join(getRiffDir(), "logs"), []byte("blocked"), 0644); err != nil {
		t.Fatal(err)
	}
	assertSyncMutation(t, true, func() error {
		if err := ReviewFlashcard(deck.ID, cardID, riff.Rating(3), nil); err == nil {
			t.Fatal("expected review log failure")
		}
		return nil
	})
	loaded, err := riff.LoadDeck(getRiffDir(), deck.ID, Conf.Flashcard.RequestRetention, Conf.Flashcard.MaximumInterval, Conf.Flashcard.Weights)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.GetCard(cardID) == nil || loaded.GetCard(cardID).GetState() == riff.New {
		t.Fatal("reviewed card should remain persisted despite log failure")
	}
}
