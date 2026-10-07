package bazaar

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func pluginArchiveFixture() (*util.PluginDevelopmentGrant, map[string][]byte) {
	return &util.PluginDevelopmentGrant{PackageName: "sample", Frontend: "desktop", AllowFiles: []string{"README.md", "plugin.json", "index.js"}}, map[string][]byte{
		"plugin.json": []byte(`{"name":"sample","version":"1.0.0","frontends":["desktop"],"readme":{"default":"README.md"}}`),
		"index.js":    []byte(`const {Plugin}=require("siyuan"); module.exports=class extends Plugin {};`),
		"README.md":   []byte("Sample plugin"),
	}
}

func TestPluginProjectPackageDeterministic(t *testing.T) {
	grant, snapshot := pluginArchiveFixture()
	first, a, err := buildPluginProjectArchive(grant, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	grant.AllowFiles = []string{"index.js", "README.md", "plugin.json"}
	second, b, err := buildPluginProjectArchive(grant, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, second) || a.PackageHash != b.PackageHash || a.SourceRevision != b.SourceRevision || a.FileListDigest != b.FileListDigest {
		t.Fatal("identical frozen content did not produce identical ZIP bytes")
	}
	r, err := zip.NewReader(bytes.NewReader(first), int64(len(first)))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range r.File {
		names = append(names, f.Name)
		if f.Mode().Perm() != 0644 || f.Modified.Year() != 1980 || f.Method != zip.Deflate {
			t.Fatalf("unstable archive metadata: %+v", f.FileHeader)
		}
	}
	if !reflect.DeepEqual(names, []string{"README.md", "index.js", "plugin.json"}) {
		t.Fatal(names)
	}
	for _, check := range []string{"javascriptSyntax", "typescriptBuild", "installation", "frontendLoading", "runtimeBehavior"} {
		if a.Checks[check] != "not run" {
			t.Fatal("unsupported check marked passed", check)
		}
	}
}

func TestPluginProjectPackageAllowsDeletedOptionalMember(t *testing.T) {
	grant, snapshot := pluginArchiveFixture()
	grant.AllowFiles = append(grant.AllowFiles, "unused.js")
	archive, _, err := buildPluginProjectArchive(grant, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	r, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatal(err)
	}
	if len(r.File) != 3 {
		t.Fatal("missing optional member was included")
	}
	grant.AllowFiles = append(grant.AllowFiles, "assets/a.svg", "ASSETS/b.svg")
	snapshot["assets/a.svg"] = []byte("a")
	snapshot["ASSETS/b.svg"] = []byte("b")
	if _, _, err = buildPluginProjectArchive(grant, snapshot); err == nil {
		t.Fatal("case-colliding path prefix accepted")
	}
}

func TestPluginProjectPackageRejectsKernelAndCredentialFiles(t *testing.T) {
	for _, name := range []string{"kernel.js", "secrets.json", "auth.json", "token.json", "token.txt", "credentials.txt", "settings.json"} {
		t.Run(name, func(t *testing.T) {
			grant, snapshot := pluginArchiveFixture()
			grant.AllowFiles = append(grant.AllowFiles, name)
			snapshot[name] = []byte("not safe for this workflow")
			if _, _, err := buildPluginProjectArchive(grant, snapshot); err == nil {
				t.Fatal("out-of-scope member accepted")
			}
		})
	}
	grant, snapshot := pluginArchiveFixture()
	snapshot["plugin.json"] = []byte(`{"name":"sample","version":"1.0.0","kernels":["desktop"]}`)
	if _, _, err := buildPluginProjectArchive(grant, snapshot); err == nil {
		t.Fatal("kernel declaration accepted")
	}
}

func TestPluginProjectPackageRejectsUnsafeMembersAndResources(t *testing.T) {
	for _, kind := range []string{"traversal", "absolute", "backslash", "duplicate", "case", "secret-name", "secret-bytes", "missing-entry", "typescript-only", "missing-readme", "missing-icon", "frontend", "name", "undeclared", "size"} {
		t.Run(kind, func(t *testing.T) {
			grant, snapshot := pluginArchiveFixture()
			switch kind {
			case "traversal":
				grant.AllowFiles = append(grant.AllowFiles, "../escape")
				snapshot["../escape"] = []byte("x")
			case "absolute":
				grant.AllowFiles = append(grant.AllowFiles, "/escape")
				snapshot["/escape"] = []byte("x")
			case "backslash":
				grant.AllowFiles = append(grant.AllowFiles, `a\b`)
				snapshot[`a\b`] = []byte("x")
			case "duplicate":
				grant.AllowFiles = append(grant.AllowFiles, "index.js")
			case "case":
				grant.AllowFiles = append(grant.AllowFiles, "INDEX.JS")
				snapshot["INDEX.JS"] = []byte("x")
			case "secret-name":
				grant.AllowFiles = append(grant.AllowFiles, ".env")
				snapshot[".env"] = []byte("x")
			case "secret-bytes":
				snapshot["index.js"] = []byte("-----BEGIN OPENSSH PRIVATE KEY-----")
			case "missing-entry":
				delete(snapshot, "index.js")
			case "typescript-only":
				delete(snapshot, "index.js")
				snapshot["index.ts"] = []byte("const x: number=1")
				grant.AllowFiles = []string{"README.md", "plugin.json", "index.ts"}
			case "missing-readme":
				snapshot["plugin.json"] = []byte(`{"name":"sample","version":"1.0.0","readme":{"default":"absent.md"}}`)
			case "missing-icon":
				snapshot["plugin.json"] = []byte(`{"name":"sample","version":"1.0.0","icon":"absent.png"}`)
			case "frontend":
				grant.Frontend = "mobile"
			case "name":
				grant.PackageName = "other"
			case "undeclared":
				snapshot["extra.js"] = []byte("x")
			case "size":
				snapshot["index.js"] = make([]byte, util.PluginProjectMaxFileBytes+1)
			}
			if data, artifact, err := buildPluginProjectArchive(grant, snapshot); err == nil || data != nil || artifact != nil {
				t.Fatalf("unsafe package accepted: %s", kind)
			}
		})
	}
}

func pluginPackageProjectFixture(t *testing.T) (context.Context, *util.PluginDevelopmentGrant) {
	t.Helper()
	oldWorkspace, oldData, oldConf, oldTemp := util.WorkspaceDir, util.DataDir, util.ConfDir, util.TempDir
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	util.ConfDir = filepath.Join(util.WorkspaceDir, "conf")
	util.TempDir = filepath.Join(util.WorkspaceDir, "temp")
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir, util.ConfDir, util.TempDir = oldWorkspace, oldData, oldConf, oldTemp
	})
	grant, snapshot := pluginArchiveFixture()
	grant.SessionID = "session"
	grant.TaskID = "task123"
	grant.PlanHash = "plan"
	grant.PlanVersion = 1
	grant.SourcePath = "imports/sample"
	grant.SourceRoot = filepath.Join(util.PluginProjectRoot(grant.TaskID), "source")
	source := filepath.Join(util.WorkspaceDir, grant.SourcePath)
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	for name, data := range snapshot {
		if err := os.WriteFile(filepath.Join(source, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	status, err := util.InspectPluginProjectSource(source, nil)
	if err != nil {
		t.Fatal(err)
	}
	grant.SourceRevision = status.SourceRevision
	ctx := util.WithPluginDevelopmentAccess(context.Background(), func(string) (*util.PluginDevelopmentGrant, error) { return grant, nil })
	if _, err = util.PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	return ctx, grant
}

func TestPluginProjectPackagePublicationAndInvalidation(t *testing.T) {
	ctx, grant := pluginPackageProjectFixture(t)
	status, err := util.GetPluginProjectStatus(ctx, grant.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = PackagePluginProject(ctx, grant.TaskID, "stale"); err == nil {
		t.Fatal("stale source accepted")
	}
	if _, err = os.Stat(filepath.Join(util.PluginProjectRoot(grant.TaskID), "artifacts")); !os.IsNotExist(err) {
		t.Fatal("archive directory created on failed validation", err)
	}
	a, err := PackagePluginProject(ctx, grant.TaskID, status.SourceRevision)
	if err != nil {
		t.Fatal(err)
	}
	b, err := PackagePluginProject(ctx, grant.TaskID, status.SourceRevision)
	if err != nil {
		t.Fatal(err)
	}
	if a.PackageHash != b.PackageHash || a.PackagePath != b.PackagePath {
		t.Fatal("unstable publication")
	}
	archive, err := ResolvePluginProjectArtifact(ctx, grant.TaskID, a.PackagePath, a.PackageHash)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(archive)
	if err != nil || util.PluginProjectDigest(data) != a.PackageHash {
		t.Fatal("wrong archive", err)
	}
	delivery, err := os.ReadFile(filepath.Join(util.WorkspaceDir, a.DeliveryPath))
	if err != nil || !bytes.Equal(delivery, data) || a.DownloadURL == "" {
		t.Fatal("delivery copy differs", err)
	}
	resolved, err := ResolvePluginProjectArtifact(ctx, grant.TaskID, a.DeliveryPath, a.PackageHash)
	if err != nil || resolved != archive {
		t.Fatal("delivery install did not use authoritative archive", err)
	}
	entries, err := os.ReadDir(filepath.Dir(archive))
	if err != nil || len(entries) != 1 || strings.HasPrefix(entries[0].Name(), ".") {
		t.Fatal("partial artifact remains", err)
	}
	status, err = util.GetPluginProjectStatus(ctx, grant.TaskID)
	if err != nil || status.Artifact == nil {
		t.Fatal("artifact not marked ready", err)
	}
	old, err := os.ReadFile(filepath.Join(grant.SourceRoot, "index.js"))
	if err != nil {
		t.Fatal(err)
	}
	newContent := append(append([]byte(nil), old...), []byte("\n// changed")...)
	err = util.WithPluginProjectSource(ctx, true, func(g *util.PluginDevelopmentGrant, root *os.Root) error {
		if err := util.BeginPluginProjectMutation(g, "index.js", util.PluginProjectDigest(old), util.PluginProjectDigest(newContent)); err != nil {
			return err
		}
		if err := root.WriteFile("index.js", newContent, 0600); err != nil {
			return err
		}
		return util.FinishPluginProjectMutation(g, "index.js")
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ResolvePluginProjectArtifact(ctx, grant.TaskID, a.PackagePath, a.PackageHash); err == nil {
		t.Fatal("stale artifact accepted after edit")
	}
	status, err = util.GetPluginProjectStatus(ctx, grant.TaskID)
	if err != nil || status.Artifact != nil {
		t.Fatal("stale artifact still ready", err)
	}
}

func TestPluginProjectPackageExternalChangeDoesNotPublish(t *testing.T) {
	ctx, grant := pluginPackageProjectFixture(t)
	if err := os.WriteFile(filepath.Join(grant.SourceRoot, "index.js"), []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	status, err := util.GetPluginProjectStatus(ctx, grant.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = PackagePluginProject(ctx, grant.TaskID, status.SourceRevision); err == nil {
		t.Fatal("external changes packaged")
	}
	if _, err = os.Stat(filepath.Join(util.PluginProjectRoot(grant.TaskID), "artifacts")); !os.IsNotExist(err) {
		t.Fatal("archive published after external change", err)
	}
}

func TestPluginProjectArchiveExistingParserCompatibility(t *testing.T) {
	ctx, grant := pluginPackageProjectFixture(t)
	status, _ := util.GetPluginProjectStatus(ctx, grant.TaskID)
	a, err := PackagePluginProject(ctx, grant.TaskID, status.SourceRevision)
	if err != nil {
		t.Fatal(err)
	}
	oldTemp := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTemp })
	typ, pkg, _, cleanup, err := ExtractLocalPackage(filepath.Join(util.WorkspaceDir, a.PackagePath))
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil || typ != "plugins" || pkg.Name != grant.PackageName {
		t.Fatal(typ, pkg, err)
	}
	encoded, _ := json.Marshal(a)
	if !bytes.Contains(encoded, []byte(`"javascriptSyntax":"not run"`)) {
		t.Fatal("validation claim changed")
	}
}
