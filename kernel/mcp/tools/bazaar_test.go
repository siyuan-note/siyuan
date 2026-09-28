package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
		{"action": "update_all", "frontend": "desktop", "packages": []any{map[string]any{"pkgType": "plugins", "packageName": "sample"}}},
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
	var page bazaarPage
	if result.IsError || json.Unmarshal([]byte(probeText(result)), &page) != nil || page.Total != 0 || page.Packages == nil {
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
	var page bazaarPage
	if result.IsError || json.Unmarshal([]byte(probeText(result)), &page) != nil || len(page.Packages) != 1 {
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
	oldInstall, oldUpdates := bazaarInstallPackage, bazaarGetUpdates
	t.Cleanup(func() { bazaarInstallPackage, bazaarGetUpdates = oldInstall, oldUpdates })
	var calls []string
	bazaarInstallPackage = func(pkgType, repoURL, repoHash, repoRef, name string, options *model.ThemeInstallOptions) error {
		calls = append(calls, pkgType+"/"+name+"/"+repoHash)
		if repoURL != "https://github.com/example/"+name || repoRef != "v2" || options != nil {
			t.Fatal("install must use the validated catalog snapshot")
		}
		if name == "broken" {
			return errors.New("download failed")
		}
		return nil
	}
	available := func(name string) *model.UpdatedPackage {
		return &model.UpdatedPackage{Installed: &bazaar.Package{Name: name, Version: "1"}, Available: &bazaar.Package{
			Name: name, Version: "2", RepoHash: "hash-" + name, RepoURL: "https://github.com/example/" + name, RepoRef: "v2",
		}}
	}
	broken := available("broken")
	queries := 0
	bazaarGetUpdates = func(frontend string) (plugins, widgets, icons, themes, templates []*model.UpdatedPackage, err error) {
		if frontend != "mobile" {
			t.Fatal("frontend compatibility context was lost")
		}
		queries++
		return []*model.UpdatedPackage{broken}, []*model.UpdatedPackage{available("one")}, nil,
			[]*model.UpdatedPackage{available("three")}, nil, nil
	}
	target := func(pkgType, name string) any {
		return map[string]any{"pkgType": pkgType, "packageName": name, "repoHash": "hash-" + name}
	}
	args := map[string]any{"action": "update_all", "frontend": "mobile", "packages": []any{
		target("widgets", "one"), target("plugins", "broken"), target("themes", "three"),
	}}
	result, _ := bazaarHandler(context.Background(), args)
	if !result.IsError || !strings.Contains(probeText(result), "download failed") || !strings.Contains(probeText(result), "themes/three") {
		t.Fatalf("partial failure was not reported: %+v", result)
	}
	if queries != 1 || !reflect.DeepEqual(calls, []string{"widgets/one/hash-one", "plugins/broken/hash-broken", "themes/three/hash-three"}) {
		t.Fatalf("unexpected update scope: %v", calls)
	}
	calls = nil
	broken.Available.RepoHash = "new-hash"
	result, _ = bazaarHandler(context.Background(), args)
	if !result.IsError || !strings.Contains(probeText(result), "confirm again") || len(calls) != 0 {
		t.Fatal("a later target's drift must prevent all writes")
	}
	broken.Available.RepoHash = "hash-broken"
	broken.Available.DisallowUpdate = true
	result, _ = bazaarHandler(context.Background(), args)
	if !result.IsError || len(calls) != 0 {
		t.Fatal("blocked targets must prevent all writes")
	}
	broken.Available.DisallowUpdate = false
	model.Conf.Bazaar.PetalDisabled = true
	result, _ = bazaarHandler(context.Background(), args)
	if !result.IsError || len(calls) != 0 {
		t.Fatal("all targets must be checked before any package is updated")
	}
	model.Conf.Bazaar.PetalDisabled = false
	duplicate := target("widgets", "one").(map[string]any)
	duplicate["repoHash"] = "different-hash"
	args["packages"] = []any{target("widgets", "one"), duplicate}
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

func readBazaarPage(t *testing.T, args map[string]any) bazaarPage {
	t.Helper()
	result, err := bazaarHandler(context.Background(), args)
	if err != nil || result.IsError {
		t.Fatalf("list failed: %+v, %v", result, err)
	}
	text := probeText(result)
	if len([]rune(text)) >= util.MaxToolOutputChars || strings.Contains(text, "README_CONTENT") {
		t.Fatal("package listing must stay compact and omit README content")
	}
	var page bazaarPage
	if err = json.Unmarshal([]byte(text), &page); err != nil {
		t.Fatal(err)
	}
	return page
}

func TestBazaarToolCompactPagination(t *testing.T) {
	setupBazaarToolTest(t)
	oldList := bazaarListPackages
	t.Cleanup(func() { bazaarListPackages = oldList })
	var packages []*bazaar.Package
	for i := 72; i >= 0; i-- {
		packages = append(packages, &bazaar.Package{
			Name: fmt.Sprintf("package-%02d", i), Version: "1.0.0", Author: "example",
			PreferredReadme: strings.Repeat("README_CONTENT", 4000),
			Readme:          bazaar.LocaleStrings{"default": "README_CONTENT"},
			Funding:         &bazaar.Funding{Patreon: "README_CONTENT"}, Keywords: []string{"README_CONTENT"},
			PreferredDeprecatedReason: "README_CONTENT",
		})
	}
	bazaarListPackages = func(pkgType, frontend, keyword string) ([]*bazaar.Package, error) {
		if keyword != "example" {
			t.Fatal("keyword must still be passed to the existing matcher")
		}
		return packages, nil
	}
	args := map[string]any{"action": "list", "pkgType": "plugins", "keyword": "example"}
	page := readBazaarPage(t, args)
	if page.Total != 73 || page.Limit != 20 || len(page.Packages) != 20 || !page.HasMore || page.Packages[0].Name != "package-00" {
		t.Fatalf("unexpected first page: %+v", page)
	}
	args["offset"], args["limit"] = 20, 50
	page = readBazaarPage(t, args)
	if len(page.Packages) != 50 || page.Packages[0].Name != "package-20" || !page.HasMore {
		t.Fatalf("unexpected middle page: %+v", page)
	}
	args["offset"] = 70
	page = readBazaarPage(t, args)
	if len(page.Packages) != 3 || page.Packages[0].Name != "package-70" || page.HasMore {
		t.Fatalf("unexpected last page: %+v", page)
	}
	args["offset"] = 999
	page = readBazaarPage(t, args)
	if page.Total != 73 || page.Offset != 999 || page.Packages == nil || len(page.Packages) != 0 || page.HasMore {
		t.Fatalf("unexpected exhausted page: %+v", page)
	}
	for _, invalid := range []map[string]any{
		{"offset": -1}, {"offset": 0.5}, {"offset": 1e30}, {"limit": 0}, {"limit": -1}, {"limit": 51}, {"limit": 1.5}, {"enabled": true},
	} {
		invalid["action"], invalid["pkgType"] = "list", "plugins"
		result, _ := bazaarHandler(context.Background(), invalid)
		if !result.IsError {
			t.Fatalf("invalid paging/filter input accepted: %v", invalid)
		}
	}
}

func TestBazaarToolInstalledEnabledFilter(t *testing.T) {
	setupBazaarToolTest(t)
	for _, name := range []string{"enabled", "disabled", "unregistered", "broken"} {
		manifest := fmt.Sprintf(`{"name":%q,"version":"1.0.0"}`, name)
		if name == "broken" {
			manifest = "invalid JSON"
		}
		writeProbeFile(t, filepath.Join(util.DataDir, "plugins", name, "plugin.json"), manifest)
		writeProbeFile(t, filepath.Join(util.DataDir, "plugins", name, "README.md"), strings.Repeat("README_CONTENT", 5000))
	}
	writeProbeFile(t, filepath.Join(util.DataDir, "storage", "petal", "petals.json"),
		`[{"name":"enabled","enabled":true},{"name":"disabled","enabled":false},{"name":"broken","enabled":true}]`)
	args := map[string]any{"action": "installed", "pkgType": "plugins", "frontend": "mobile"}
	page := readBazaarPage(t, args)
	if page.Total != 4 || len(page.Packages) != 4 {
		t.Fatalf("missing installed packages: %+v", page)
	}
	for _, pkg := range page.Packages {
		if pkg.Enabled == nil || *pkg.Enabled != (pkg.Name == "enabled" || pkg.Name == "broken") {
			t.Fatalf("missing or incorrect configured state: %+v", pkg)
		}
		if pkg.Name == "broken" && pkg.InvalidReason == "" {
			t.Fatal("invalid manifests must retain the reason")
		}
	}
	model.Conf.Bazaar.PetalDisabled = true
	args["enabled"] = true
	page = readBazaarPage(t, args)
	if page.Total != 2 || page.Packages[0].Name != "broken" || page.Packages[1].Name != "enabled" {
		t.Fatalf("configured state must not be confused with global runtime availability: %+v", page)
	}
	args["enabled"], args["offset"], args["limit"] = false, 1, 1
	page = readBazaarPage(t, args)
	if page.Total != 2 || len(page.Packages) != 1 || page.Packages[0].Name != "unregistered" || page.HasMore {
		t.Fatalf("enabled filtering must precede pagination: %+v", page)
	}
}

func TestBazaarToolUpdatesCompactPagination(t *testing.T) {
	setupBazaarToolTest(t)
	oldUpdates := bazaarGetUpdates
	t.Cleanup(func() { bazaarGetUpdates = oldUpdates })
	update := &model.UpdatedPackage{
		Installed: &bazaar.Package{Name: "example", Version: "1.0.0", PreferredReadme: "README_CONTENT"},
		Available: &bazaar.Package{Name: "example", Version: "2.0.0", RepoHash: "confirmed-hash", PreferredReadme: "README_CONTENT"},
	}
	bazaarGetUpdates = func(string) (plugins, widgets, icons, themes, templates []*model.UpdatedPackage, err error) {
		return []*model.UpdatedPackage{update}, nil, nil, []*model.UpdatedPackage{update}, nil, nil
	}
	args := map[string]any{"action": "updates", "limit": 1}
	page := readBazaarPage(t, args)
	if page.Total != 2 || !page.HasMore || len(page.Packages) != 1 {
		t.Fatalf("updates must paginate across package types: %+v", page)
	}
	pkg := page.Packages[0]
	if pkg.PkgType != "plugins" || pkg.InstalledVersion != "1.0.0" || pkg.Version != "2.0.0" ||
		pkg.RepoHash != "confirmed-hash" || pkg.Enabled == nil || *pkg.Enabled {
		t.Fatalf("update lost selection or version information: %+v", pkg)
	}
	args["pkgType"] = "themes"
	page = readBazaarPage(t, args)
	if page.Total != 1 || page.HasMore || page.Packages[0].PkgType != "themes" || page.Packages[0].Enabled != nil {
		t.Fatalf("updates type filter is incorrect: %+v", page)
	}
}
