package tools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupBazaarToolTest(t *testing.T) string {
	t.Helper()
	root := setupProbeWorkspace(t)
	oldConf, oldReadonly := model.Conf, util.ReadOnly
	model.Conf = model.NewAppConf()
	model.Conf.Bazaar = &conf.Bazaar{Trust: true}
	model.Conf.Sync = conf.NewSync()
	model.Conf.Sync.Enabled = false
	util.ReadOnly = false
	t.Cleanup(func() { model.Conf, util.ReadOnly = oldConf, oldReadonly })
	return root
}

func TestBazaarToolGuards(t *testing.T) {
	setupBazaarToolTest(t)
	for _, args := range []map[string]any{
		{"action": "unknown"},
		{"action": "list", "pkgType": "other"},
		{"action": "list"},
		{"action": "readme", "pkgType": "plugins"},
		{"action": "install", "pkgType": "plugins", "packageName": "sample"},
		{"action": "enable", "pkgType": "themes", "packageName": "sample", "frontend": "mobile"},
		{"action": "enable", "pkgType": "plugins", "packageName": "../sample", "frontend": "mobile"},
		{"action": "update_all", "frontend": "desktop"},
		{"action": "update_all", "frontend": "desktop", "packages": []any{map[string]any{"pkgType": "other", "packageName": "sample"}}},
		{"action": "install_local", "frontend": "desktop", "path": "../outside.zip"},
		{"action": "install_local", "frontend": "desktop", "path": "conf/conf.json"},
	} {
		result, err := bazaarHandler(context.Background(), args)
		if err != nil || !result.IsError {
			t.Fatalf("expected guarded failure for %v: %+v, %v", args, result, err)
		}
	}
	for _, action := range []string{"install", "uninstall", "update", "enable", "disable", "install_local", "update_all"} {
		util.ReadOnly = true
		result, _ := bazaarHandler(context.Background(), map[string]any{
			"action": action, "pkgType": "plugins", "packageName": "sample", "frontend": "desktop",
		})
		if !result.IsError || !strings.Contains(probeText(result), "read-only") {
			t.Fatalf("write %s bypassed read-only mode: %+v", action, result)
		}
	}
	util.ReadOnly = false
	model.Conf.Bazaar.Trust = false
	for _, action := range []string{"list", "updates", "readme", "install", "enable"} {
		result, _ := bazaarHandler(context.Background(), map[string]any{
			"action": action, "pkgType": "plugins", "packageName": "sample", "frontend": "desktop",
		})
		if !result.IsError || !strings.Contains(probeText(result), "not trusted") {
			t.Fatalf("action %s bypassed Bazaar trust: %+v", action, result)
		}
	}
	result, _ := bazaarHandler(context.Background(), map[string]any{"action": "installed", "pkgType": "widgets"})
	if result.IsError || probeText(result) != "[]" {
		t.Fatalf("local listing should remain available: %+v", result)
	}
	model.Conf.Bazaar.Trust = true
	model.Conf.Bazaar.PetalDisabled = true
	for _, action := range []string{"install", "update", "uninstall", "enable", "disable"} {
		result, _ = bazaarHandler(context.Background(), map[string]any{
			"action": action, "pkgType": "plugins", "packageName": "sample", "frontend": "mobile",
		})
		if !result.IsError || !strings.Contains(probeText(result), "globally disabled") {
			t.Fatalf("action %s bypassed plugin switch: %+v", action, result)
		}
	}
}

func TestBazaarToolListAndInstallChecks(t *testing.T) {
	setupBazaarToolTest(t)
	oldList := bazaarListPackages
	t.Cleanup(func() { bazaarListPackages = oldList })
	bazaarListPackages = func(pkgType, frontend, keyword string) ([]*bazaar.Package, error) {
		if pkgType != "plugins" || frontend != "mobile" || keyword != "" {
			t.Fatalf("unexpected catalog request: %s/%s/%s", pkgType, frontend, keyword)
		}
		return nil, errors.New("catalog offline")
	}
	args := map[string]any{"action": "list", "pkgType": "plugins", "frontend": "mobile"}
	result, _ := bazaarHandler(context.Background(), args)
	if !result.IsError || !strings.Contains(probeText(result), "catalog offline") {
		t.Fatalf("network failure must not look like an empty catalog: %+v", result)
	}
	pkg := &bazaar.Package{Name: "sample", DisallowInstall: true}
	bazaarListPackages = func(string, string, string) ([]*bazaar.Package, error) {
		return []*bazaar.Package{pkg}, nil
	}
	result, _ = bazaarHandler(context.Background(), args)
	var packages []*bazaar.Package
	if result.IsError || json.Unmarshal([]byte(probeText(result)), &packages) != nil || len(packages) != 1 {
		t.Fatalf("catalog result lost package data: %+v", result)
	}
	args["action"], args["packageName"] = "install", "sample"
	result, _ = bazaarHandler(context.Background(), args)
	if !result.IsError || !strings.Contains(probeText(result), "incompatible") {
		t.Fatalf("incompatible package reached installation: %+v", result)
	}
	pkg.DisallowInstall, pkg.Installed = false, true
	result, _ = bazaarHandler(context.Background(), args)
	if !result.IsError || !strings.Contains(probeText(result), "already installed") {
		t.Fatalf("install should not silently overwrite: %+v", result)
	}
}

func TestBazaarToolUpdateAllTargetsAndFailures(t *testing.T) {
	setupBazaarToolTest(t)
	oldUpdate := bazaarUpdatePackage
	t.Cleanup(func() { bazaarUpdatePackage = oldUpdate })
	var calls []string
	bazaarUpdatePackage = func(pkgType, name, frontend string) error {
		calls = append(calls, pkgType+"/"+name+"/"+frontend)
		if name == "broken" {
			return errors.New("download failed")
		}
		return nil
	}
	target := func(pkgType, name string) any { return map[string]any{"pkgType": pkgType, "packageName": name} }
	args := map[string]any{"action": "update_all", "frontend": "mobile", "packages": []any{
		target("widgets", "one"), target("plugins", "broken"), target("themes", "three"),
	}}
	result, _ := bazaarHandler(context.Background(), args)
	if !result.IsError || !strings.Contains(probeText(result), "download failed") || !strings.Contains(probeText(result), "themes/three") {
		t.Fatalf("partial failure was not reported: %+v", result)
	}
	if !reflect.DeepEqual(calls, []string{"widgets/one/mobile", "plugins/broken/mobile", "themes/three/mobile"}) {
		t.Fatalf("unexpected update scope: %v", calls)
	}
	calls = nil
	model.Conf.Bazaar.PetalDisabled = true
	result, _ = bazaarHandler(context.Background(), args)
	if !result.IsError || len(calls) != 0 {
		t.Fatal("all targets must be checked before any package is updated")
	}
	model.Conf.Bazaar.PetalDisabled = false
	args["packages"] = []any{target("widgets", "one"), target("widgets", "one")}
	result, _ = bazaarHandler(context.Background(), args)
	if !result.IsError || len(calls) != 0 {
		t.Fatal("duplicate targets must be rejected before updating")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, _ = bazaarHandler(ctx, args)
	if !result.IsError || len(calls) != 0 {
		t.Fatal("cancelled operation should not write")
	}
}

func TestBazaarToolLocalPluginLifecycle(t *testing.T) {
	root := setupBazaarToolTest(t)
	writeProbeZip(t, filepath.Join(root, "sample.zip"), []probeZipEntry{
		{name: "plugin.json", body: `{"name":"sample","version":"1.0.0","backends":["all"],"frontends":["mobile"]}`},
		{name: "index.js", body: "export default {};"},
	})
	args := map[string]any{"action": "install_local", "path": "sample.zip", "frontend": "mobile"}
	model.Conf.Bazaar.PetalDisabled = true
	result, _ := bazaarHandler(context.Background(), args)
	if !result.IsError || !strings.Contains(probeText(result), "globally disabled") {
		t.Fatalf("local install bypassed global plugin switch: %+v", result)
	}
	model.Conf.Bazaar.PetalDisabled = false
	result, err := bazaarHandler(context.Background(), args)
	if err != nil || result.IsError {
		t.Fatalf("local install failed: %+v, %v", result, err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "plugins", "sample", "plugin.json")); err != nil {
		t.Fatal(err)
	}
	if petal := model.GetPetalByName("sample"); petal != nil && petal.Enabled {
		t.Fatal("new plugin was enabled without a separate enable action")
	}
	result, _ = bazaarHandler(context.Background(), args)
	if !result.IsError {
		t.Fatal("local overwrite must be explicit")
	}
	args["overwrite"] = true
	result, _ = bazaarHandler(context.Background(), args)
	if result.IsError {
		t.Fatalf("explicit overwrite failed: %+v", result)
	}
	args = map[string]any{"action": "enable", "pkgType": "plugins", "packageName": "sample", "frontend": "desktop"}
	result, _ = bazaarHandler(context.Background(), args)
	if !result.IsError {
		t.Fatal("mobile-only plugin must not be enabled for desktop")
	}
	args["frontend"] = "mobile"
	result, _ = bazaarHandler(context.Background(), args)
	if result.IsError || model.GetPetalByName("sample") == nil || !model.GetPetalByName("sample").Enabled {
		t.Fatalf("enable did not persist plugin state: %+v", result)
	}
	args["action"] = "disable"
	result, _ = bazaarHandler(context.Background(), args)
	if result.IsError || model.GetPetalByName("sample").Enabled {
		t.Fatalf("disable did not persist plugin state: %+v", result)
	}
	args["action"] = "uninstall"
	result, _ = bazaarHandler(context.Background(), args)
	if result.IsError {
		t.Fatalf("uninstall failed: %+v", result)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "plugins", "sample")); !os.IsNotExist(err) {
		t.Fatalf("uninstall left the package directory: %v", err)
	}
}
