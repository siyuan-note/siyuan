package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestConfAllSectionsShareStartupAndWriteNormalization(t *testing.T) {
	prepareConfConsistencyTest(t)
	raw := []byte(`{
		"editor":{"fontSize":200,"backlinkGlobalSort":7,"backlinkBlockSort":-9,"floatWindowMode":42,
			"headingEmbedMode":-3,"databaseAttrClickMode":99,"databaseAttrViewMode":-1,"codeTabSpaces":5},
		"export":{"blockEmbedMode":9,"fileAnnotationRefMode":-5},
		"appearance":{"closeButtonBehavior":5},"sync":{"interval":1,"assetDownloadMode":7},
		"system":{"autoLaunch2":9,"lockScreenMode":3},"flashcard":{"reviewMode":7},
		"search":{"limit":1000000},"fileTree":{"maxListCount":1000000,"largeFileWarningSize":1000000},
		"repo":{"indexRetentionDays":100000},"ocr":{"provider":"tesseract","model":"tiny"},
		"ai":{"agent":{"maxToolCallRounds":-7,"confirmTimeout":-9,"temperature":-3,"maxCompletionTokens":-2}}
	}`)
	startup := NewAppConf()
	if err := json.Unmarshal(raw, startup); err != nil {
		t.Fatal(err)
	}
	normalizeAppConf(startup)
	for namespace := range confSectionSpecFactories {
		t.Run(namespace, func(t *testing.T) {
			Conf = NewAppConf()
			normalizeAppConf(Conf)
			input := NewAppConf()
			if err := json.Unmarshal(raw, input); err != nil {
				t.Fatal(err)
			}
			var value any
			typ := reflect.TypeOf(*input)
			for i := 0; i < typ.NumField(); i++ {
				if jsonFieldName(typ, typ.Field(i).Name) == namespace {
					data, _ := json.Marshal(reflect.ValueOf(input).Elem().Field(i).Interface())
					if err := json.Unmarshal(data, &value); err != nil {
						t.Fatal(err)
					}
					break
				}
			}
			spec, _ := SectionSpecByNamespace(namespace)
			// 路径一致性检查只运行提交规则，领域动作由各功能回归测试覆盖。
			reflect.ValueOf(spec).Elem().FieldByName("Reactions").SetZero()
			if _, err := spec.apply(value); err != nil {
				t.Fatal(err)
			}
			actual, _ := json.Marshal(spec.load())
			var expected []byte
			for i := 0; i < typ.NumField(); i++ {
				if jsonFieldName(typ, typ.Field(i).Name) == namespace {
					expected, _ = json.Marshal(reflect.ValueOf(startup).Elem().Field(i).Interface())
					break
				}
			}
			if !bytes.Equal(actual, expected) {
				t.Fatalf("startup and write differ: %s\n%s", expected, actual)
			}
		})
	}
}

func TestConfSectionLookupBindsOnlyTheCurrentWorkspaceSection(t *testing.T) {
	prepareConfConsistencyTest(t)
	Conf = NewAppConf()
	Conf.Editor = ConfSection[conf.Editor]{}
	first := Conf
	first.System.Store(conf.NormalizeSystem(nil))
	spec, ok := SectionSpecByNamespace("system")
	if !ok || spec.load() != first.System.Load() || first.Editor.cell != nil {
		t.Fatal("section lookup initialized unrelated configuration or bound the wrong section")
	}
	Conf = NewAppConf()
	Conf.System.Store(conf.NormalizeSystem(nil))
	current, ok := SectionSpecByNamespace("system")
	if !ok || current.load() != Conf.System.Load() || spec.load() != first.System.Load() {
		t.Fatal("section lookup reused a previous workspace binding")
	}
	if _, ok = SectionSpecByNamespace("unknown"); ok {
		t.Fatal("unknown configuration section was registered")
	}
}

func TestConfMigrationRetriesFailedStorageAndLostVersion(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	Conf.ConfVersion = 2
	profile := &conf.EntryVisibilityProfile{ID: "custom", Name: "Custom", Entries: map[string]bool{}}
	Conf.Appearance.Load().EntryVisibility.Profiles = append(Conf.Appearance.Load().EntryVisibility.Profiles, profile)
	storage := filepath.Join(util.DataDir, "storage", "local.json")
	if err := os.MkdirAll(filepath.Dir(storage), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(storage, []byte(`{`), 0600); err != nil {
		t.Fatal(err)
	}
	applyConfMigrations(Conf, nil)
	if Conf.ConfVersion != 2 {
		t.Fatal("failed storage migration was marked complete")
	}
	if err := os.WriteFile(storage, []byte(`{"local-slash-frequent-enabled":false}`), 0600); err != nil {
		t.Fatal(err)
	}
	applyConfMigrations(Conf, nil)
	if Conf.ConfVersion != CurrentConfVersion || profile.Entries["editor.slash.menu.frequent"] {
		t.Fatal("storage migration did not retry successfully")
	}
	first, _ := json.Marshal(Conf)
	Conf.ConfVersion = 0
	applyConfMigrations(Conf, first)
	second, _ := json.Marshal(Conf)
	if !bytes.Equal(first, second) {
		t.Fatal("rerunning migrations after losing confVersion changed settings")
	}
}

func TestConfConcurrentReadersHoldCoherentSnapshots(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	util.ReadOnly = true
	UpdateSyncConf(func(value *conf.Sync) { value.Interval = 100; value.CloudName = "100" })
	var group sync.WaitGroup
	group.Add(2)
	go func() {
		defer group.Done()
		for i := 0; i < 100; i++ {
			UpdateSyncConf(func(value *conf.Sync) { value.Interval = 200; value.CloudName = "200" })
			UpdateSyncConf(func(value *conf.Sync) { value.Interval = 100; value.CloudName = "100" })
		}
	}()
	go func() {
		defer group.Done()
		for i := 0; i < 100000; i++ {
			snapshot := Conf.Sync.Load()
			if snapshot.Interval == 100 && snapshot.CloudName != "100" || snapshot.Interval == 200 && snapshot.CloudName != "200" {
				t.Error("reader observed fields from different commits")
				return
			}
		}
	}()
	group.Wait()
}

func TestConfWritesProjectDerivedStateAndKeepInputsImmutable(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	previous := Conf.Editor.Load()
	input := cloneConfSection(previous)
	input.Markdown.InlineMath = !previous.Markdown.InlineMath
	input.FontSize = 200
	before := ConfNamespaceRevision("editor")
	if _, err := ApplyConfSection("editor", input); err != nil {
		t.Fatal(err)
	}
	if input.FontSize != 200 || previous.Markdown.InlineMath == input.Markdown.InlineMath && Conf.Editor.Load() == previous {
		t.Fatal("submission changed its input or held snapshot")
	}
	if util.MarkdownSettings.Load() != Conf.Editor.Load().Markdown ||
		util.UseSingleLineSave.Load() != Conf.FileTree.Load().UseSingleLineSave ||
		util.LargeFileWarningSize.Load() != Conf.FileTree.Load().LargeFileWarningSize ||
		util.StatusBarCfg.Load() != Conf.Appearance.Load().StatusBar ||
		util.NotificationsCfg.Load() != Conf.Appearance.Load().Notifications ||
		util.SearchCaseSensitive.Load() != Conf.Search.Load().CaseSensitive ||
		util.SearchHanSensitive.Load() != Conf.Search.Load().HanSensitiveVal() ||
		ConfNamespaceRevision("editor") <= before {
		t.Fatal("configuration commit omitted projection or notification")
	}
}

func TestConfGraphQueryDoesNotMutateHeldSnapshot(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	held := Conf.Graph.Load()
	before, _ := json.Marshal(held)
	global := cloneConfSection(held.Global)
	global.DailyNote = !global.DailyNote
	Conf.SaveGraphQueryConf(global, nil)
	after, _ := json.Marshal(held)
	if !bytes.Equal(before, after) {
		t.Fatal("graph query changed a held snapshot")
	}
}

func TestConfDirectApplyClonesNestedInputs(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	util.ReadOnly = true
	input := cloneConfSection(Conf.Editor.Load())
	input.FontSize = 200
	spec := newSectionSpec("editor", &Conf.Editor, conf.NormalizeEditor)
	if _, err := Apply(spec, input); err != nil {
		t.Fatal(err)
	}
	stored := Conf.Editor.Load()
	if input.FontSize != 200 || stored.FontSize == 200 || stored == input || stored.Markdown == input.Markdown {
		t.Fatal("direct submission reused its input during normalization")
	}
	inlineMath := stored.Markdown.InlineMath
	input.Markdown.InlineMath = !inlineMath
	if stored.Markdown.InlineMath != inlineMath {
		t.Fatal("published snapshot still shares nested input data")
	}
}

func TestConfOnboardingPreservesPublishedSnapshots(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	if err := os.MkdirAll(util.DataDir, 0700); err != nil {
		t.Fatal(err)
	}
	completed := &conf.Onboarding{State: conf.OnboardingCompleted, Dismissed: true}
	Conf.Onboarding.Store(completed)
	TriggerOnboardingIfEmpty()
	pending := Conf.Onboarding.Load()
	if completed.State != conf.OnboardingCompleted || !completed.Dismissed ||
		pending == completed || pending.State != conf.OnboardingPending || !pending.NewUser {
		t.Fatal("triggering onboarding changed a published snapshot")
	}
	DismissOnboarding()
	if pending.Dismissed || !Conf.Onboarding.Load().Dismissed {
		t.Fatal("dismissing onboarding changed a held snapshot")
	}
	missing := &conf.Onboarding{State: conf.OnboardingCompleted, NewUser: true, NotebookID: "missing", DocumentID: "missing"}
	Conf.Onboarding.Store(missing)
	util.ReadOnly = true
	if _, _, err := EnsureOnboarding(); err == nil {
		t.Fatal("read-only workspace created onboarding data")
	}
	if missing.State != conf.OnboardingCompleted || missing.NotebookID != "missing" ||
		Conf.Onboarding.Load() == missing || Conf.Onboarding.Load().State != conf.OnboardingPending {
		t.Fatal("reconciling onboarding changed a published snapshot")
	}
}

func TestConfDeltaUpdatePreservesAnInterleavedInternalPublication(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	util.ReadOnly = true
	interleaved := false
	UpdateSystemConf(func(value *conf.System) {
		if !interleaved {
			interleaved = true
			Conf.m.Lock()
			replaceConfSectionLocked(&Conf.System, func(current *conf.System) bool {
				current.Name = "updated host"
				return true
			})
			Conf.m.Unlock()
		}
		value.SettingsWindow = true
	})
	current := Conf.System.Load()
	if !current.SettingsWindow || current.Name != "updated host" {
		t.Fatal("delta update overwrote an interleaved internal publication")
	}
}

func TestConfAppearancePreferencesDoNotInitializeResources(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	util.ReadOnly = true
	previous := util.AppearancePath
	util.AppearancePath = ""
	t.Cleanup(func() { util.AppearancePath = previous })
	held := Conf.Appearance.Load()
	UpdateAppearanceConf(func(value *conf.Appearance) { value.ThemeJS = !held.ThemeJS })
	if Conf.Appearance.Load().ThemeJS == held.ThemeJS {
		t.Fatal("appearance preference did not publish its snapshot")
	}
}
