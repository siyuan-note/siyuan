package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func mapTestString(value string) *string { return &value }

func setMapForTest(app *AppConf, inputs []MapServiceInput) (*conf.Map, error) {
	revision := ""
	if app.Map != nil {
		revision = app.Map.Revision
	}
	return app.SetMap(inputs, revision)
}

func mapTestConfig(t *testing.T) *AppConf {
	t.Helper()
	oldDir, oldReadonly := util.ConfDir, util.ReadOnly
	util.ConfDir, util.ReadOnly = t.TempDir(), false
	t.Cleanup(func() { util.ConfDir, util.ReadOnly = oldDir, oldReadonly })
	return NewAppConf()
}

func TestMapConfigDefaultsAndLegacyNil(t *testing.T) {
	for _, body := range []string{`{}`, `{"map":null}`, `{"map":{}}`, `{"map":{"services":null}}`} {
		app := NewAppConf()
		if err := json.Unmarshal([]byte(body), app); err != nil {
			t.Fatal(err)
		}
		app.Map = normalizeMapConfig(app.Map)
		if app.Map.Services == nil || len(app.Map.Services) != 0 || app.Map.Revision != "" {
			t.Fatalf("legacy configuration acquired a default service: %s", body)
		}
		app.Map.DecryptCredentials()
		if _, err := app.GetMapRuntime("missing"); err == nil {
			t.Fatal("empty configuration resolved a runtime")
		}
	}
	var config *conf.Map
	config.EncryptCredentials()
	config.DecryptCredentials()
	if len(config.Masked().Services) != 0 {
		t.Fatal("nil map configuration is not safely readable")
	}
}

func TestMapConfigCredentialsAndStableReferences(t *testing.T) {
	app := mapTestConfig(t)
	inputs := []MapServiceInput{
		{ID: "synced-view-service", Name: " AMap ", Provider: conf.MapProviderAMap, APIKey: mapTestString("test-amap-key"), SecurityCode: mapTestString("test-amap-code")},
		{Name: "Free", Provider: conf.MapProviderOpenFreeMap},
		{ID: "second", Name: "Tencent", Provider: conf.MapProviderTencent, APIKey: mapTestString("test-tencent-key")},
	}
	masked, err := setMapForTest(app, inputs)
	if err != nil {
		t.Fatal(err)
	}
	generatedID := masked.Services[1].ID
	if !conf.IsMapServiceID(generatedID) || masked.Services[0].ID != "synced-view-service" || masked.Services[0].Name != "AMap" {
		t.Fatal("stable IDs or normalization changed")
	}
	for _, service := range masked.Services {
		if service.APIKey != "" || service.SecurityCode != "" || !service.Configured() {
			t.Fatal("save returned a credential or lost presence metadata")
		}
	}
	if !masked.Services[0].HasSecurityCode() || !masked.Services[0].HasAPIKey() || masked.Services[1].HasAPIKey() {
		t.Fatal("masked credential metadata is inaccurate")
	}
	for _, id := range []string{"", "missing", "https://invalid.example", " space "} {
		if _, err = app.GetMapRuntime(id); err == nil {
			t.Fatalf("missing or malformed ID resolved: %q", id)
		}
	}
	selected, err := app.GetMapRuntime("second")
	if err != nil || selected.APIKey != "test-tencent-key" || selected.SecurityCode != "" {
		t.Fatal("runtime did not select only the requested provider")
	}
	selected.APIKey = "changed-copy"
	if app.Map.Services[2].APIKey != "test-tencent-key" {
		t.Fatal("runtime exposed mutable active configuration")
	}
	inputs = []MapServiceInput{
		{ID: generatedID, Name: "Free renamed", Provider: conf.MapProviderOpenFreeMap},
		{ID: "synced-view-service", Name: "Renamed", Provider: conf.MapProviderAMap},
	}
	if _, err = setMapForTest(app, inputs); err != nil {
		t.Fatal(err)
	}
	if app.Map.Services[1].APIKey != "test-amap-key" || app.Map.Services[1].SecurityCode != "test-amap-code" {
		t.Fatal("omitted credentials did not survive rename/reorder")
	}
	if _, err = app.GetMapRuntime("second"); err == nil {
		t.Fatal("removed service still resolved")
	}
	inputs[1].SecurityCode = mapTestString("")
	if _, err = setMapForTest(app, inputs); err != nil {
		t.Fatal(err)
	}
	if app.GetMap().Services[1].Configured() || app.Map.Services[1].APIKey != "test-amap-key" {
		t.Fatal("explicit secret clear failed or cleared an omitted key")
	}
	if _, err = app.GetMapRuntime("synced-view-service"); err == nil {
		t.Fatal("incomplete AMap service resolved")
	}
	inputs[1].Provider, inputs[1].SecurityCode = conf.MapProviderBaidu, nil
	if _, err = setMapForTest(app, inputs); err != nil {
		t.Fatal(err)
	}
	if app.Map.Services[1].APIKey != "" || app.Map.Services[1].SecurityCode != "" {
		t.Fatal("provider change retained credentials")
	}
	inputs[1].APIKey = mapTestString("test-baidu-key")
	if _, err = setMapForTest(app, inputs); err != nil {
		t.Fatal(err)
	}
	if selected, err = app.GetMapRuntime("synced-view-service"); err != nil || selected.APIKey != "test-baidu-key" {
		t.Fatal("replacement provider credentials were not usable")
	}
	if _, err = setMapForTest(app, []MapServiceInput{}); err != nil || len(app.Map.Services) != 0 {
		t.Fatal("empty full list did not remove services")
	}
	if _, err = setMapForTest(app, []MapServiceInput{{ID: "synced-view-service", Name: "Configure missing reference", Provider: conf.MapProviderOpenFreeMap}}); err != nil || app.Map.Services[0].ID != "synced-view-service" {
		t.Fatal("cross-device missing reference could not be explicitly configured")
	}
}

func TestMapConfigRejectsInvalidChangesAtomically(t *testing.T) {
	app := mapTestConfig(t)
	input := MapServiceInput{ID: "existing", Name: "Original", Provider: conf.MapProviderAMap, APIKey: mapTestString("test-key"), SecurityCode: mapTestString("test-code")}
	if _, err := setMapForTest(app, []MapServiceInput{input}); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(app.Map)
	disk, _ := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	invalid := []MapServiceInput{
		{ID: "../bad", Name: "Bad", Provider: conf.MapProviderAMap},
		{ID: strings.Repeat("a", 129), Name: "Bad", Provider: conf.MapProviderAMap},
		{ID: "existing", Name: "Bad", Provider: conf.MapProviderBaidu},
		{ID: "next", Name: " ", Provider: conf.MapProviderAMap},
		{ID: "next", Name: "Bad", Provider: "https://unknown.example"},
		{ID: "next", Name: "Bad", Provider: conf.MapProviderOpenFreeMap, APIKey: mapTestString("not-allowed")},
		{ID: "next", Name: "Bad", Provider: conf.MapProviderTencent, SecurityCode: mapTestString("not-allowed")},
		{ID: "next", Name: "Bad", Provider: conf.MapProviderAMap, APIKey: mapTestString(strings.Repeat("x", 4097))},
	}
	for _, value := range invalid {
		if _, err := setMapForTest(app, []MapServiceInput{input, value}); err == nil {
			t.Fatalf("invalid input accepted: ID=%q, provider=%q", value.ID, value.Provider)
		}
		after, _ := json.Marshal(app.Map)
		stored, _ := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
		if !bytes.Equal(before, after) || !bytes.Equal(disk, stored) {
			t.Fatal("rejected full list partially mutated configuration")
		}
	}
	util.ReadOnly = true
	if _, err := setMapForTest(app, nil); err == nil || len(app.Map.Services) != 1 {
		t.Fatal("read-only configuration was changed")
	}
	util.ReadOnly = false
	util.ConfDir = filepath.Join(util.ConfDir, "conf.json") // 已有文件不能作为父目录。
	if _, err := setMapForTest(app, nil); err == nil || len(app.Map.Services) != 1 {
		t.Fatal("failed persistence left a changed active configuration")
	}
}

func TestMapConfigEncryptedStorageAndMaskedReads(t *testing.T) {
	app := mapTestConfig(t)
	app.Map = &conf.Map{Services: []*conf.MapService{{ID: "local", Name: "Local", Provider: conf.MapProviderAMap, APIKey: "map-test-private-key", SecurityCode: "map-test-private-code"}}}
	before, _ := json.Marshal(app.Map)
	app.Save()
	app.Save()
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil || bytes.Contains(data, []byte("map-test-private")) {
		t.Fatal("map credentials were not encrypted for storage")
	}
	after, _ := json.Marshal(app.Map)
	if !bytes.Equal(before, after) {
		t.Fatal("save mutated runtime credentials")
	}
	stored := NewAppConf()
	if err = json.Unmarshal(data, stored); err != nil {
		t.Fatal(err)
	}
	stored.Map.DecryptCredentials()
	if !reflect.DeepEqual(stored.Map, app.Map) {
		t.Fatal("stored map credentials did not round-trip")
	}
	oldConf := Conf
	Conf = app
	t.Cleanup(func() { Conf = oldConf })
	masked, err := GetMaskedConf()
	if err != nil {
		t.Fatal(err)
	}
	serialized, _ := json.Marshal(masked)
	if bytes.Contains(serialized, []byte("map-test-private")) || !masked.Map.Services[0].Configured() {
		t.Fatal("masked configuration leaked credentials or lost configured status")
	}
	masked.System = &conf.System{}
	HideConfSecret(masked)
	if len(masked.Map.Services) != 0 {
		t.Fatal("published configuration retained device service metadata")
	}
	if app.Map.Services[0].APIKey != "map-test-private-key" {
		t.Fatal("masked read changed active credentials")
	}
}

func TestMapConfigDecryptPreservesUnrecognizedInput(t *testing.T) {
	for _, value := range []string{"", "legacy-plain-key", "0011", "00000000000000000000000000000000"} {
		config := &conf.Map{Services: []*conf.MapService{nil, {APIKey: value, SecurityCode: value}}}
		config.DecryptCredentials()
		if config.Services[1].APIKey != value || config.Services[1].SecurityCode != value {
			t.Fatal("unrecognized stored credential was silently destroyed")
		}
	}
}

func TestMapConfigRevisionPreventsStaleWholeListWrites(t *testing.T) {
	app := mapTestConfig(t)
	initialRevision := app.Map.Revision
	inputs := []MapServiceInput{{ID: "new-service", Name: "New service", Provider: conf.MapProviderTencent, APIKey: mapTestString("preserved-concurrent-key")}}
	first, err := app.SetMap(inputs, initialRevision)
	if err != nil || first.Revision == "" || first.Revision == initialRevision || first.Revision != app.Map.Revision {
		t.Fatal("successful map write did not publish a new independent revision")
	}
	path := filepath.Join(util.ConfDir, "conf.json")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = app.SetMap([]MapServiceInput{}, initialRevision); err == nil || err.Error() != "mapSettingsConflict" {
		t.Fatal("stale whole-list write did not report a conflict")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) || len(app.Map.Services) != 1 || app.Map.Services[0].APIKey != "preserved-concurrent-key" || app.Map.Revision != first.Revision {
		t.Fatal("stale write deleted another window's service or credential")
	}
	inputs[0].Name, inputs[0].APIKey = "Rename", nil
	second, err := app.SetMap(inputs, first.Revision)
	if err != nil || second.Revision == first.Revision || app.Map.Services[0].APIKey != "preserved-concurrent-key" {
		t.Fatal("current revision could not save without replacing omitted credentials")
	}
	data, err := os.ReadFile(path)
	stored := NewAppConf()
	if err != nil || json.Unmarshal(data, stored) != nil || stored.Map.Revision != second.Revision {
		t.Fatal("map revision was not persisted with its service list")
	}
}
