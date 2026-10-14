package model

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"sync"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// legacyConfFixture 覆盖旧版字段、越界值和缺失配置段。
const legacyConfFixture = `{
	"ai": {"openAI": {"apiKey": "", "apiModel": "gpt-4o"}},
	"appearance": {"icon": "ant", "codeBlockThemeDark": "", "statusBar": null},
	"editor": {"fontSize": 200, "blockRefDynamicAnchorTextMaxLen": 0},
	"export": {"blockRefMode": 1, "pandocParams": "--wrap=none"},
	"fileTree": {"maxListCount": 0, "maxOpenTabCount": 99},
	"sync": {"mode": 0, "interval": 5, "lan": {"maxConcurrentReqs": 999}},
	"repo": {"syncIndexTiming": 1, "indexRetentionDays": 0},
	"graph": {"local": null},
	"search": {"limit": 1},
	"publish": {"auth": null},
	"system": {"id": "fixture-device", "name": "fixture-host", "networkProxy": null}
}`

func prepareConfConsistencyTest(t *testing.T) {
	t.Helper()
	previous, readOnly, confDir, dataDir := Conf, util.ReadOnly, util.ConfDir, util.DataDir
	lang := util.Lang
	markdown, singleLine, largeFile := util.MarkdownSettings.Load(), util.UseSingleLineSave.Load(), util.LargeFileWarningSize.Load()
	statusBar, notifications := util.StatusBarCfg.Load(), util.NotificationsCfg.Load()
	persisted := lastPersistedConf()
	t.Cleanup(func() {
		Conf, util.ReadOnly, util.ConfDir, util.DataDir = previous, readOnly, confDir, dataDir
		util.Lang = lang
		{
			derivedValue0, derivedValue1, derivedValue2 := markdown, singleLine, largeFile
			util.MarkdownSettings.Store(derivedValue0)
			util.UseSingleLineSave.Store(derivedValue1)
			util.LargeFileWarningSize.Store(derivedValue2)
		}
		{
			derivedValue0, derivedValue1 := statusBar, notifications
			util.StatusBarCfg.Store(derivedValue0)
			util.NotificationsCfg.Store(derivedValue1)
		}
		recordPersistedConf(persisted)
		if previous != nil && previous.Search.Load() != nil {
			ApplySearchRuntime()
		}
	})
	root := t.TempDir()
	util.ReadOnly, util.ConfDir, util.DataDir = false, root, filepath.Join(root, "data")
	Conf = NewAppConf()
}

func loadConfFixture(t *testing.T, raw string) *AppConf {
	t.Helper()
	c := NewAppConf()
	if err := json.Unmarshal([]byte(raw), c); err != nil {
		t.Fatal(err)
	}
	return c
}

// I1：启动路径与写入路径对同一配置段产出相同结果；I6：规范化只依赖输入，构造函数不读可变全局状态。
func TestConfNormalizeIsSharedAndIdempotent(t *testing.T) {
	prepareConfConsistencyTest(t)
	c := loadConfFixture(t, legacyConfFixture)
	normalizeAppConf(c)
	first, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	normalizeAppConf(c)
	second, _ := json.Marshal(c)
	if string(first) != string(second) {
		t.Fatal("normalization is not idempotent")
	}
	if c.Appearance.Load().Icon != "litheness" || c.Appearance.Load().CodeBlockThemeDark == "" || c.Appearance.Load().StatusBar == nil ||
		c.Editor.Load().FontSize != 16 || c.Export.Load().BlockRefMode != 1 || c.FileTree.Load().MaxListCount != 512 ||
		c.FileTree.Load().MaxOpenTabCount != 32 || c.Sync.Load().Mode != 1 || c.Sync.Load().Interval != 30 || c.Sync.Load().LAN.MaxConcurrentReqs != 128 ||
		c.Repo.Load().SyncIndexTiming != 12000 || c.Repo.Load().IndexRetentionDays != 180 || c.Graph.Load().Local == nil ||
		c.Search.Load().Limit != 32 || c.Publish.Load().Auth == nil {
		t.Fatalf("legacy values were not normalized: %s", first)
	}
	for name, value := range map[string]any{
		"tag": c.Tag.Load(), "snippet": c.Snippet.Load(), "api": c.Api.Load(), "bazaar": c.Bazaar.Load(), "notebookCrypto": c.NotebookCrypto,
		"stat": c.Stat.Load(), "ocr": c.OCR.Load(), "oidc": c.OIDC, "secrets": c.Secrets.Load(), "variables": c.Variables.Load(),
		"keymap": c.Keymap.Load(), "uiLayout": c.UILayout.Load(), "onboarding": c.Onboarding.Load(), "system": c.System.Load(),
	} {
		if reflect.ValueOf(value).IsNil() {
			t.Fatalf("section %s was not filled", name)
		}
	}

	// 写入路径以段为单位规范化，结果必须与整体规范化一致
	sections := []struct {
		name      string
		normalize func(*AppConf)
	}{
		{"sync", func(c *AppConf) { c.Sync.Store(conf.NormalizeSync(c.Sync.Load())) }},
		{"system", func(c *AppConf) { c.System.Store(conf.NormalizeSystem(c.System.Load())) }},
		{"repo", func(c *AppConf) { c.Repo.Store(conf.NormalizeRepo(c.Repo.Load())) }},
		{"editor", func(c *AppConf) { c.Editor.Store(conf.NormalizeEditor(c.Editor.Load())) }},
		{"appearance", func(c *AppConf) {
			c.Appearance.Store(conf.NormalizeAppearance(c.Appearance.Load(), util.IsMobileContainer()))
		}},
		{"graph", func(c *AppConf) { c.Graph.Store(conf.NormalizeGraph(c.Graph.Load())) }},
		{"publish", func(c *AppConf) { c.Publish.Store(conf.NormalizePublish(c.Publish.Load())) }},
	}
	for _, section := range sections {
		whole, single := loadConfFixture(t, legacyConfFixture), loadConfFixture(t, legacyConfFixture)
		normalizeAppConf(whole)
		section.normalize(single)
		a, _ := json.Marshal(reflect.ValueOf(whole).Elem().FieldByNameFunc(func(name string) bool {
			return jsonFieldName(reflect.TypeOf(*whole), name) == section.name
		}).Interface())
		b, _ := json.Marshal(reflect.ValueOf(single).Elem().FieldByNameFunc(func(name string) bool {
			return jsonFieldName(reflect.TypeOf(*single), name) == section.name
		}).Interface())
		if string(a) != string(b) {
			t.Fatalf("section %s differs between startup and write normalization:\n%s\n%s", section.name, a, b)
		}
	}
	{
		derivedValue0,

			// 构造函数不继承运行时状态
			derivedValue1 := !util.DefaultUseSingleLineSave, 99
		util.UseSingleLineSave.Store(derivedValue0)
		util.LargeFileWarningSize.Store(derivedValue1)
	}
	if fileTree := conf.NewFileTree(); fileTree.UseSingleLineSave != util.DefaultUseSingleLineSave ||
		fileTree.LargeFileWarningSize != util.DefaultLargeFileWarningSize {
		t.Fatal("NewFileTree inherits mutable runtime state")
	}
}

func jsonFieldName(typ reflect.Type, fieldName string) string {
	field, ok := typ.FieldByName(fieldName)
	if !ok {
		return ""
	}
	tag := field.Tag.Get("json")
	for i, ch := range tag {
		if ch == ',' {
			return tag[:i]
		}
	}
	return tag
}

// I3：迁移全量应用两次，第二次无修改；I7：配置版本高于本内核时不执行迁移、不改写版本。
func TestConfMigrationsAreVersioned(t *testing.T) {
	prepareConfConsistencyTest(t)
	raw := []byte(legacyConfFixture)
	c := loadConfFixture(t, legacyConfFixture)
	if !applyConfMigrations(c, raw) || c.ConfVersion != CurrentConfVersion {
		t.Fatal("legacy configuration was not migrated")
	}
	if c.AI.Load() == nil || c.Appearance.Load() == nil || c.Appearance.Load().EntryVisibility == nil ||
		c.Appearance.Load().EntryVisibility.Active != conf.EntryVisibilityProfileFull {
		t.Fatal("legacy AI or entry visibility migration was not applied")
	}
	before, _ := json.Marshal(c)
	if applyConfMigrations(c, raw) {
		t.Fatal("second migration pass changed the configuration")
	}
	after, _ := json.Marshal(c)
	if string(before) != string(after) {
		t.Fatal("second migration pass rewrote the configuration")
	}

	for i := 1; i < len(confMigrations); i++ {
		if confMigrations[i].version <= confMigrations[i-1].version {
			t.Fatal("migration versions must increase strictly")
		}
	}

	future := loadConfFixture(t, legacyConfFixture)
	future.ConfVersion = CurrentConfVersion + 1
	if applyConfMigrations(future, raw) || future.ConfVersion != CurrentConfVersion+1 || future.Export.Load().BlockRefMode != 1 {
		t.Fatal("configuration written by a newer kernel was migrated or downgraded")
	}
	normalizeAppConf(future)
	if future.ConfVersion != CurrentConfVersion+1 {
		t.Fatal("normalization changed the configuration version")
	}
}

// I4：配置写入后派生运行时状态由唯一函数重新投影。
func TestApplyConfRuntimeProjectsDerivedState(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	Conf.FileTree.Load().UseSingleLineSave = !util.DefaultUseSingleLineSave
	Conf.FileTree.Load().LargeFileWarningSize = 42
	Conf.Search.Load().CaseSensitive = true
	applyConfRuntime()
	if util.UseSingleLineSave.Load() != Conf.FileTree.Load().UseSingleLineSave || util.LargeFileWarningSize.Load() != 42 ||
		util.MarkdownSettings.Load() != Conf.Editor.Load().Markdown || util.StatusBarCfg.Load() != Conf.Appearance.Load().StatusBar ||
		util.NotificationsCfg.Load() != Conf.Appearance.Load().Notifications || !util.SearchCaseSensitive.Load() ||
		util.SearchHanSensitive.Load() != Conf.Search.Load().HanSensitiveVal() {
		t.Fatal("derived runtime state was not projected from the configuration")
	}
	sql.SetCaseSensitive(false)
}

// I10：段快照更新期间，读方取得的段在其生命周期内保持字段间自洽。
func TestConfSectionSnapshotsAreConsistent(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	held := Conf.Sync.Load()
	heldInterval, heldMode := held.Interval, held.Mode
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			UpdateSyncConf(func(s *conf.Sync) {
				s.Interval = 60 + i
				s.Mode = 2 + i%2
			})
		}(i)
	}
	wg.Wait()
	if held.Interval != heldInterval || held.Mode != heldMode {
		t.Fatal("a section held by a reader was mutated in place")
	}
	if Conf.Sync.Load() == held || Conf.Sync.Load().Interval < 60 {
		t.Fatal("section update did not replace the section")
	}
	for _, section := range []any{Conf.Sync.Load(), Conf.System.Load(), Conf.Repo.Load(), Conf.Editor.Load(), Conf.Appearance.Load(), Conf.Bazaar.Load(), Conf.Graph.Load(),
		Conf.Tag.Load(), Conf.Api.Load(), Conf.Publish.Load(), Conf.Onboarding.Load(), Conf.Stat.Load()} {
		// 按实际类型执行与 cloneConfSection 相同的 JSON 往返，确认配置段没有不可序列化的状态
		value := reflect.ValueOf(section)
		data, _ := json.Marshal(section)
		copied := reflect.New(value.Elem().Type())
		if err := json.Unmarshal(data, copied.Interface()); err != nil || !reflect.DeepEqual(copied.Interface(), section) {
			t.Fatalf("section %T cannot be copied losslessly", section)
		}
	}
	if !reflect.DeepEqual(cloneConfSection(Conf.Search.Load()), Conf.Search.Load()) || !reflect.DeepEqual(cloneConfSection(Conf.AI.Load()), Conf.AI.Load()) {
		t.Fatal("search or AI section cannot be copied losslessly")
	}
}
