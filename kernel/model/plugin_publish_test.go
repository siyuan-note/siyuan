package model

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupPluginPublishTest(t *testing.T) func(string) {
	t.Helper()
	originalData, originalConfDir, originalConf := util.DataDir, util.ConfDir, Conf
	root := t.TempDir()
	util.DataDir, util.ConfDir = filepath.Join(root, "data"), filepath.Join(root, "conf")
	Conf = NewAppConf()
	Conf.Sync = conf.NewSync()
	Conf.Bazaar = &conf.Bazaar{Trust: true}
	Conf.Lang = "en"
	t.Cleanup(func() { util.DataDir, util.ConfDir, Conf = originalData, originalConfDir, originalConf })
	write := func(declaration string) {
		t.Helper()
		dir := filepath.Join(util.DataDir, "plugins", "example")
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		manifest := `{"name":"example","version":"1.0.0","minAppVersion":"0.0.1","publish":` + declaration + `}`
		if err := os.WriteFile(filepath.Join(dir, "plugin.json"), []byte(manifest), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write(`{"resources":["image.png"],"data":["theme","showAuthor"]}`)
	for name, value := range map[string]string{"index.js": "frontend", "kernel.js": "private kernel", "index.css": "body {}", "image.png": "image", "private.json": "secret"} {
		if err := os.WriteFile(filepath.Join(util.DataDir, "plugins", "example", name), []byte(value), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := SetPetalEnabled("example", true); err != nil {
		t.Fatal(err)
	}
	return write
}

func TestPluginPublishDataLifecycle(t *testing.T) {
	write := setupPluginPublishTest(t)
	data := map[string]json.RawMessage{"theme": json.RawMessage(`"dark"`), "showAuthor": json.RawMessage(`true`)}
	if err := SavePluginPublishData("example", data); !errors.Is(err, ErrPluginPublishDenied) {
		t.Fatalf("ungranted write: %v", err)
	}
	if err := SetPluginPublishDataGrant("example", []string{"theme"}, true); !errors.Is(err, ErrPluginPublishInvalid) {
		t.Fatalf("stale grant: %v", err)
	}
	grant := func() {
		t.Helper()
		if err := SetPluginPublishDataGrant("example", []string{"showAuthor", "theme"}, true); err != nil {
			t.Fatal(err)
		}
	}
	grant()
	if _, err := LoadPluginPublishData("example"); !errors.Is(err, ErrPluginPublishMissing) {
		t.Fatalf("missing snapshot: %v", err)
	}
	if err := SavePluginPublishData("example", data); err != nil {
		t.Fatal(err)
	}
	if err := SavePluginPublishData("example", map[string]json.RawMessage{"theme": json.RawMessage(`"light"`)}); err != nil {
		t.Fatal(err)
	}
	actual, err := LoadPluginPublishData("example")
	if err != nil || len(actual) != 1 || string(actual["theme"]) != `"light"` {
		t.Fatalf("snapshot replacement: %s %v", actual, err)
	}
	for _, invalid := range []map[string]json.RawMessage{
		{"token": json.RawMessage(`"secret"`)}, {"theme": json.RawMessage(`{"token":"secret"}`)}, {"theme": json.RawMessage(`[]`)}, {"theme": json.RawMessage(`invalid`)},
	} {
		if err := SavePluginPublishData("example", invalid); !errors.Is(err, ErrPluginPublishInvalid) {
			t.Fatalf("invalid snapshot accepted: %v", err)
		}
	}
	if actual, err = LoadPluginPublishData("example"); err != nil || string(actual["theme"]) != `"light"` {
		t.Fatalf("failed write damaged snapshot: %v", err)
	}
	if _, err = SetPetalPublishEnabled("example", false); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadPluginPublishData("example"); !errors.Is(err, ErrPluginPublishDenied) {
		t.Fatalf("disabled publish read: %v", err)
	}
	if _, err = SetPetalPublishEnabled("example", true); err != nil {
		t.Fatal(err)
	}
	Conf.Bazaar.PetalDisabled = true
	if _, err = LoadPluginPublishData("example"); !errors.Is(err, ErrPluginPublishDenied) {
		t.Fatalf("global disable read: %v", err)
	}
	Conf.Bazaar.PetalDisabled = false
	if _, err = SetPetalEnabled("example", false); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadPluginPublishData("example"); !errors.Is(err, ErrPluginPublishDenied) {
		t.Fatalf("disabled plugin read: %v", err)
	}
	if _, err = SetPetalEnabled("example", true); err != nil {
		t.Fatal(err)
	}
	write(`{"data":["theme","showAuthor","newField"]}`)
	if _, err = LoadPluginPublishData("example"); !errors.Is(err, ErrPluginPublishDenied) {
		t.Fatalf("expanded scope read: %v", err)
	}
	write(`{"data":["showAuthor"]}`)
	if actual, err = LoadPluginPublishData("example"); err != nil || len(actual) != 0 {
		t.Fatalf("removed field still exposed: %v %v", actual, err)
	}
	write(`{"data":["theme","showAuthor"]}`)
	if _, err = LoadPluginPublishData("example"); !errors.Is(err, ErrPluginPublishDenied) {
		t.Fatalf("restored field inherited removed authorization: %v", err)
	}
	if err = SetPluginPublishDataGrant("example", nil, false); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadPluginPublishData("example"); !errors.Is(err, ErrPluginPublishDenied) {
		t.Fatalf("revoked read: %v", err)
	}
	grant()
	if _, err = LoadPluginPublishData("example"); !errors.Is(err, ErrPluginPublishMissing) {
		t.Fatalf("regrant resurrected snapshot: %v", err)
	}
	if err = SavePluginPublishData("example", data); err != nil {
		t.Fatal(err)
	}
	if err = UninstallPackage("plugins", "example"); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(pluginPublishStatePath("example")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("uninstall retained data: %v", err)
	}
	write(`{"data":["theme","showAuthor"]}`)
	if _, err = SetPetalEnabled("example", true); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadPluginPublishData("example"); !errors.Is(err, ErrPluginPublishDenied) {
		t.Fatalf("reinstall inherited grant: %v", err)
	}
}

func TestPluginPublishCorruptionPreserved(t *testing.T) {
	setupPluginPublishTest(t)
	if err := os.MkdirAll(filepath.Dir(pluginPublishStatePath("example")), 0700); err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{`{"version":99}`, `{broken`, `{}`, `{"version":1,"granted":["theme"],"data":{"theme":{"secret":1}}}`} {
		if err := os.WriteFile(pluginPublishStatePath("example"), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadPluginPublishData("example"); err == nil {
			t.Fatal("corrupt data accepted")
		}
		if err := SetPluginPublishDataGrant("example", []string{"theme", "showAuthor"}, true); err == nil {
			t.Fatal("corrupt state overwritten")
		}
		actual, err := os.ReadFile(pluginPublishStatePath("example"))
		if err != nil || string(actual) != content {
			t.Fatalf("original not preserved: %v", err)
		}
	}
}

func TestPluginPublishResources(t *testing.T) {
	write := setupPluginPublishTest(t)
	for _, resource := range []string{"index.js", "index.css", "image.png"} {
		file, err := OpenPluginPublishResource("example", resource)
		if err != nil {
			t.Fatalf("%s: %v", resource, err)
		}
		file.Close()
	}
	for _, resource := range []string{"kernel.js", "private.json", "plugin.json", "../example/private.json", "%2e%2e/private.json", "image.png:secret"} {
		file, err := OpenPluginPublishResource("example", resource)
		if err == nil {
			file.Close()
			t.Fatalf("unauthorized resource %s", resource)
		}
	}
	petals := LoadPetals("browser-desktop", true)
	if len(petals) != 1 || petals[0].JS != "frontend" || petals[0].Kernel.JS != "" {
		t.Fatalf("unexpected publish payload: %+v", petals)
	}
	if err := os.Remove(filepath.Join(util.DataDir, "plugins", "example", "image.png")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(util.DataDir, "plugins", "example", "private.json"), filepath.Join(util.DataDir, "plugins", "example", "image.png")); err == nil {
		if file, err := OpenPluginPublishResource("example", "image.png"); err == nil {
			file.Close()
			t.Fatal("link exposed private resource")
		}
	} else {
		t.Logf("symlink creation unavailable: %v", err)
	}
	write(`{"resources":["kernel.js"]}`)
	if file, err := OpenPluginPublishResource("example", "kernel.js"); err == nil {
		file.Close()
		t.Fatal("kernel code can be declared public")
	}
	write(`null`)
	file, err := OpenPluginPublishResource("example", "index.js")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil || string(data) != "frontend" {
		t.Fatal("legacy entry unavailable")
	}
}
