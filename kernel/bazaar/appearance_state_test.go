package bazaar

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupAppearanceStateTest(t *testing.T) {
	t.Helper()
	oldData, oldThemes, oldIcons := util.DataDir, util.ThemesPath, util.IconsPath
	util.DataDir = t.TempDir()
	util.ThemesPath, util.IconsPath = filepath.Join(util.DataDir, "themes"), filepath.Join(util.DataDir, "icons")
	t.Cleanup(func() { util.DataDir, util.ThemesPath, util.IconsPath = oldData, oldThemes, oldIcons })
}

func TestAppearanceStateIgnoresUntrackedEmptyDirectories(t *testing.T) {
	setupAppearanceStateTest(t)
	for _, name := range []string{"empty", "ignored"} {
		if err := os.MkdirAll(filepath.Join(util.ThemesPath, name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	writeAppearanceTestFile(t, util.ThemesPath, "ignored/.draft", "keep draft")
	if err := PrepareAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"empty", "ignored"} {
		_, statePath, err := appearancePackagePaths("themes", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = os.Stat(statePath); !os.IsNotExist(err) {
			t.Fatalf("untracked empty directory received state: %s: %v", name, err)
		}
	}
	if err := PublishAppearancePackage(t.TempDir(), "themes", "explicit", PackageInfo{}, false, false); !errors.Is(err, ErrAppearancePackageEmpty) {
		t.Fatalf("empty explicit installation was accepted: %v", err)
	}

	source := t.TempDir()
	writeAppearanceTestFile(t, source, "theme.css", "recorded")
	if err := PublishAppearancePackage(source, "themes", "recorded", PackageInfo{}, false, false); err != nil {
		t.Fatal(err)
	}
	payload, statePath, _ := appearancePackagePaths("themes", "recorded")
	before, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(filepath.Join(payload, "theme.css")); err != nil {
		t.Fatal(err)
	}
	if err = PrepareAppearancePackages(); !errors.Is(err, ErrAppearancePackageEmpty) {
		t.Fatalf("incomplete recorded package was accepted: %v", err)
	}
	after, err := os.ReadFile(statePath)
	if err != nil || string(before) != string(after) {
		t.Fatalf("incomplete package state was overwritten: %s %v", after, err)
	}
}

func TestAppearanceStateRestoresIsolationBeforePackageChanges(t *testing.T) {
	setupAppearanceStateTest(t)
	source := t.TempDir()
	writeAppearanceTestFile(t, source, "theme.css", "base css")
	if err := PublishAppearancePackage(source, "themes", "example", PackageInfo{}, false, false); err != nil {
		t.Fatal(err)
	}
	rulePath := filepath.Join(util.DataDir, ".siyuan", "syncignore")
	if err := os.WriteFile(rulePath, []byte("/assets/private/\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := DeleteAppearancePackage("themes", "example"); err != nil {
		t.Fatal(err)
	}
	rules, err := os.ReadFile(rulePath)
	if err != nil || !strings.HasPrefix(string(rules), "/assets/private/\n") || !strings.Contains(string(rules), "# siyuan-appearance-isolation:v1:begin\n/themes/\n") {
		t.Fatalf("restored user rules were not isolated before deletion: %s %v", rules, err)
	}
	_, statePath, _ := appearancePackagePaths("themes", "example")
	before, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	unknown := []byte("# siyuan-appearance-isolation:v2:begin\n")
	if err = os.WriteFile(rulePath, unknown, 0644); err != nil {
		t.Fatal(err)
	}
	if err = PublishAppearancePackage(source, "themes", "example", PackageInfo{}, false, false); err == nil {
		t.Fatal("package was published through unknown isolation rules")
	}
	for target, want := range map[string][]byte{rulePath: unknown, statePath: before} {
		got, readErr := os.ReadFile(target)
		if readErr != nil || string(got) != string(want) {
			t.Fatalf("failed publication changed recovery material: %s: %v", target, readErr)
		}
	}
	if _, err = os.Stat(filepath.Join(util.ThemesPath, "example")); !os.IsNotExist(err) {
		t.Fatalf("failed publication recreated the deleted package: %v", err)
	}
}

func TestAppearanceStateCloudIntegration(t *testing.T) {
	for _, onDemand := range []bool{false, true} {
		t.Run(map[bool]string{false: "full", true: "on-demand"}[onDemand], func(t *testing.T) {
			setupAppearanceStateTest(t)
			base, remote := t.TempDir(), t.TempDir()
			newRepo := func(device string) *dejavu.Repo {
				root := filepath.Join(base, device)
				repoPath := filepath.Join(root, "repo")
				backend := cloud.NewLocal(&cloud.BaseCloud{Conf: &cloud.Conf{Dir: "main", RepoPath: repoPath, AvailableSize: 1024 * 1024 * 1024, Local: &cloud.ConfLocal{Endpoint: remote}}})
				isolation := []string{"/themes/", "/icons/", "/storage/bazaar/themes/", "/storage/bazaar/icons/"}
				repo, err := dejavu.NewRepoWithOptions(dejavu.Options{DataPath: filepath.Join(root, "data"), RepoPath: repoPath, HistoryPath: filepath.Join(root, "history"), TempPath: filepath.Join(root, "temp"), DeviceID: device, DeviceName: device, DeviceOS: "windows", AESKey: []byte("0123456789abcdef0123456789abcdef"), Cloud: backend, IgnoreRulePath: ".siyuan/syncignore", IgnoreLines: isolation, EnableAppearanceSync: true})
				if err != nil {
					t.Fatal(err)
				}
				writeAppearanceTestFile(t, repo.DataPath, "seed.txt", "seed")
				writeAppearanceTestFile(t, repo.DataPath, ".siyuan/syncignore", "# siyuan-appearance-isolation:v1:begin\n/themes/\n/icons/\n/storage/bazaar/themes/\n/storage/bazaar/icons/\n# siyuan-appearance-isolation:v1:end\n")
				if err = repo.ConfigureAssetDownloads(onDemand, filepath.Join(root, "conf", "assets"), "test-scope"); err != nil {
					t.Fatal(err)
				}
				return repo
			}
			a, b := newRepo("a"), newRepo("b")
			selectRepo := func(repo *dejavu.Repo) {
				util.DataDir = repo.DataPath
				util.ThemesPath = filepath.Join(repo.DataPath, "themes")
				util.IconsPath = filepath.Join(repo.DataPath, "icons")
			}
			syncRepo := func(repo *dejavu.Repo) {
				t.Helper()
				selectRepo(repo)
				if err := PrepareAppearancePackages(); err != nil {
					t.Fatal(err)
				}
				if _, err := repo.Index("integration", true, nil); err != nil {
					t.Fatal(err)
				}
				if _, _, err := repo.Sync(nil); err != nil {
					t.Fatal(err)
				}
				id, _, err := repo.AssetDownloadChanges()
				if err != nil {
					t.Fatal(err)
				}
				if err = repo.AcknowledgeAssetDownloadChanges(id); err != nil {
					t.Fatal(err)
				}
			}
			install := func(repo *dejavu.Repo, css, asset string, update bool) {
				t.Helper()
				selectRepo(repo)
				source := t.TempDir()
				writeAppearanceTestFile(t, source, "theme.json", `{"name":"example","version":"1.0.0"}`)
				writeAppearanceTestFile(t, source, "theme.css", css)
				writeAppearanceTestFile(t, source, "assets/font.woff", asset)
				if err := PublishAppearancePackage(source, "themes", "example", PackageInfo{InstallTime: 1}, false, update); err != nil {
					t.Fatal(err)
				}
			}
			install(a, "base css", "base font", false)
			syncRepo(a)
			syncRepo(b)
			install(a, "cloud complete css", "cloud complete font", true)
			install(b, "local competing css edited", "local competing font edited", true)
			syncRepo(a)
			syncRepo(b)
			if err := ValidateAppearancePackage("themes", "example"); err != nil {
				t.Fatal(err)
			}
			for name, want := range map[string]string{"theme.css": "cloud complete css", "assets/font.woff": "cloud complete font"} {
				data, err := os.ReadFile(filepath.Join(util.ThemesPath, "example", filepath.FromSlash(name)))
				if err != nil || string(data) != want {
					t.Fatalf("mixed kernel/DejaVu package %s: %s %v", name, data, err)
				}
			}
			deferred, err := b.DeferredAssets()
			if err != nil || len(deferred) != 0 {
				t.Fatalf("appearance asset deferred: %v %v", deferred, err)
			}
			selectRepo(a)
			if err = DeleteAppearancePackage("themes", "example"); err != nil {
				t.Fatal(err)
			}
			syncRepo(a)
			syncRepo(b)
			_, statePath, _ := appearancePackagePaths("themes", "example")
			state, err := readAppearanceState(statePath)
			if err != nil || !state.Deleted {
				t.Fatalf("kernel tombstone did not converge: %+v %v", state, err)
			}
		})
	}
}

func writeAppearanceTestFile(t *testing.T, root, name, content string) {
	t.Helper()
	filePath := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestAppearanceStateWholePackageLifecycle(t *testing.T) {
	setupAppearanceStateTest(t)
	source := t.TempDir()
	writeAppearanceTestFile(t, source, "theme.css", "old")
	writeAppearanceTestFile(t, source, "removed.js", "old only")
	writeAppearanceTestFile(t, source, ".git/config", "local")
	writeAppearanceTestFile(t, source, "cache.tmp", "local")
	legacy := `{"packages":{"themes":{"example":{"installTime":123,"repoURL":"https://github.com/owner/theme","repoRef":"main"}}}}`
	writeAppearanceTestFile(t, util.DataDir, "storage/bazaar.json", legacy)
	info, err := GetAppearancePackageInfo("themes", "example")
	if err != nil || info.InstallTime != 123 {
		t.Fatalf("legacy source: %+v %v", info, err)
	}
	if err = PublishAppearancePackage(source, "themes", "example", *info, true, false); err != nil {
		t.Fatal(err)
	}
	payload, statePath, _ := appearancePackagePaths("themes", "example")
	state, err := readAppearanceState(statePath)
	if err != nil || len(state.Files) != 2 || !state.Migration {
		t.Fatalf("state: %+v %v", state, err)
	}
	if err = ValidateAppearancePackage("themes", "example"); err != nil {
		t.Fatal(err)
	}
	next := t.TempDir()
	writeAppearanceTestFile(t, next, "theme.css", "new, same version")
	info.UpdateTime = 456
	if err = PublishAppearancePackage(next, "themes", "example", *info, false, true); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(payload, "removed.js")); !os.IsNotExist(err) {
		t.Fatalf("obsolete file remains: %v", err)
	}
	if err = ValidateAppearancePackage("themes", "example"); err != nil {
		t.Fatal(err)
	}
	if err = DeleteAppearancePackage("themes", "example"); err != nil {
		t.Fatal(err)
	}
	state, err = readAppearanceState(statePath)
	if err != nil || !state.Deleted || len(state.Files) != 0 || state.Migration {
		t.Fatalf("tombstone: %+v %v", state, err)
	}
	if _, err = os.Stat(payload); !os.IsNotExist(err) {
		t.Fatalf("deleted payload: %v", err)
	}
	if err = PrepareAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	writeAppearanceTestFile(t, payload, "theme.css", "late migration")
	if err = PrepareAppearancePackages(); err == nil {
		t.Fatal("unobserved reinstall resurrected tombstone")
	}
	if err = PublishAppearancePackage(next, "themes", "example", *info, false, true); err != nil {
		t.Fatal(err)
	}
	state, err = readAppearanceState(statePath)
	if err != nil || state.Deleted || state.Migration {
		t.Fatalf("explicit reinstall: %+v %v", state, err)
	}
	actual, err := os.ReadFile(filepath.Join(util.DataDir, "storage", "bazaar.json"))
	if err != nil || string(actual) != legacy {
		t.Fatalf("legacy metadata rewritten: %s %v", actual, err)
	}
}

func TestAppearanceStateCorruptionPreservesOriginal(t *testing.T) {
	setupAppearanceStateTest(t)
	source := t.TempDir()
	writeAppearanceTestFile(t, source, "icon.js", "original")
	if err := PublishAppearancePackage(source, "icons", "example", PackageInfo{InstallTime: 1}, false, false); err != nil {
		t.Fatal(err)
	}
	payload, statePath, _ := appearancePackagePaths("icons", "example")
	if err := os.WriteFile(statePath, []byte(`{"version":99,"deleted":false,"files":{}}`), 0644); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(statePath)
	for _, operation := range []func() error{
		func() error { return ValidateAppearancePackage("icons", "example") },
		func() error { return PrepareAppearancePackages() },
		func() error { return PublishAppearancePackage(source, "icons", "example", PackageInfo{}, false, true) },
		func() error { return DeleteAppearancePackage("icons", "example") },
	} {
		if err := operation(); err == nil {
			t.Fatal("unknown version accepted")
		}
	}
	after, _ := os.ReadFile(statePath)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("unknown state changed")
	}
	data, err := os.ReadFile(filepath.Join(payload, "icon.js"))
	if err != nil || string(data) != "original" {
		t.Fatalf("original changed: %s %v", data, err)
	}
}

func TestAppearanceStateManualChangesAndIgnore(t *testing.T) {
	setupAppearanceStateTest(t)
	payload := filepath.Join(util.ThemesPath, "manual")
	writeAppearanceTestFile(t, payload, "theme.css", "one")
	if err := PrepareAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	_, statePath, _ := appearancePackagePaths("themes", "manual")
	before, _ := os.ReadFile(statePath)
	if err := PrepareAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(statePath)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("unchanged scan rewrites state")
	}
	writeAppearanceTestFile(t, payload, "theme.css", "two")
	if err := ValidateAppearancePackage("themes", "manual"); err == nil {
		t.Fatal("unrecorded mutation accepted")
	}
	if err := PrepareAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	if err := ValidateAppearancePackage("themes", "manual"); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(payload); err != nil {
		t.Fatal(err)
	}
	if err := PrepareAppearancePackages(func(kind, name string) bool { return kind == "themes" && name == "manual" }); err != nil {
		t.Fatal(err)
	}
	state, _ := readAppearanceState(statePath)
	if state.Deleted {
		t.Fatal("ignored package removal changed shared state")
	}
	if err := PrepareAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	state, _ = readAppearanceState(statePath)
	if !state.Deleted {
		t.Fatal("manual deletion not recorded")
	}
}

func TestAppearanceOperationRecovery(t *testing.T) {
	for _, boundary := range []string{"staged", "backed-up", "renamed", "state-written", "corrupt-stage", "modified-before-recovery", "unknown-state-after-rename"} {
		t.Run(boundary, func(t *testing.T) {
			setupAppearanceStateTest(t)
			payload, statePath, _ := appearancePackagePaths("themes", "example")
			writeAppearanceTestFile(t, payload, "old.css", "recover me")
			opDir := filepath.Join(appearanceOperationsPath(), "package-test")
			stage := filepath.Join(opDir, "staging")
			writeAppearanceTestFile(t, stage, "theme.css", "new")
			files, err := appearanceFiles(stage)
			if err != nil {
				t.Fatal(err)
			}
			before, _ := appearanceFiles(payload)
			op := appearanceOperation{Version: 1, Kind: "themes", Name: "example", State: AppearancePackageState{Version: 1, Files: files}, BeforeExists: true, Before: before}
			data, _ := json.Marshal(op)
			writeAppearanceTestFile(t, opDir, "operation.json", string(data))
			if boundary == "modified-before-recovery" {
				writeAppearanceTestFile(t, payload, "old.css", "offline edit")
				if err = RecoverAppearancePackages(); err == nil {
					t.Fatal("offline change overwritten")
				}
				actual, readErr := os.ReadFile(filepath.Join(payload, "old.css"))
				if readErr != nil || string(actual) != "offline edit" {
					t.Fatal("offline change lost", readErr)
				}
				return
			}
			if boundary == "corrupt-stage" {
				writeAppearanceTestFile(t, stage, "theme.css", "corrupted")
				if err = RecoverAppearancePackages(); err == nil {
					t.Fatal("corrupted staging accepted")
				}
				if _, err = os.Stat(filepath.Join(payload, "old.css")); err != nil {
					t.Fatal("original displaced before validation", err)
				}
				return
			}
			if boundary != "staged" {
				if err = os.Rename(payload, filepath.Join(opDir, "backup")); err != nil {
					t.Fatal(err)
				}
			}
			if boundary == "renamed" || boundary == "state-written" || boundary == "unknown-state-after-rename" {
				if err = os.Rename(stage, payload); err != nil {
					t.Fatal(err)
				}
			}
			if boundary == "unknown-state-after-rename" {
				writeAppearanceTestFile(t, filepath.Dir(statePath), filepath.Base(statePath), `{"version":99,"files":{}}`)
				if err = RecoverAppearancePackages(); err == nil {
					t.Fatal("unknown state overwritten after rename")
				}
				actual, readErr := os.ReadFile(statePath)
				if readErr != nil || string(actual) != `{"version":99,"files":{}}` {
					t.Fatal("unknown state lost", readErr)
				}
				if _, err = os.Stat(filepath.Join(opDir, "backup", "old.css")); err != nil {
					t.Fatal("original backup lost", err)
				}
				return
			}
			if boundary == "state-written" {
				if err = writeAppearanceState(statePath, &op.State); err != nil {
					t.Fatal(err)
				}
			}
			if err = RecoverAppearancePackages(); err != nil {
				t.Fatal(err)
			}
			if err = ValidateAppearancePackage("themes", "example"); err != nil {
				t.Fatal(err)
			}
			if _, err = os.Stat(opDir); !os.IsNotExist(err) {
				t.Fatalf("completed journal remains: %v", err)
			}
			if err = RecoverAppearancePackages(); err != nil {
				t.Fatal("recovery not idempotent", err)
			}
		})
	}
}

func TestAppearanceDeleteRecoveryAfterBackupArchive(t *testing.T) {
	setupAppearanceStateTest(t)
	_, statePath, _ := appearancePackagePaths("themes", "example")
	opDir := filepath.Join(appearanceOperationsPath(), "package-deleted")
	op := appearanceOperation{Version: 1, Kind: "themes", Name: "example", BeforeExists: true, Before: map[string]string{}, State: AppearancePackageState{Version: 1, Deleted: true, Files: map[string]string{}}}
	data, _ := json.Marshal(op)
	writeAppearanceTestFile(t, opDir, "operation.json", string(data))
	writeAppearanceTestFile(t, filepath.Join(util.DataDir, ".siyuan-appearance-backups", filepath.Base(opDir)), "theme.css", "original")
	if err := writeAppearanceState(statePath, &op.State); err != nil {
		t.Fatal(err)
	}
	if err := RecoverAppearancePackages(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(opDir); !os.IsNotExist(err) {
		t.Fatal("completed deletion journal remains", err)
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, ".siyuan-appearance-backups", filepath.Base(opDir), "theme.css")); err != nil {
		t.Fatal("archived original lost", err)
	}
}
