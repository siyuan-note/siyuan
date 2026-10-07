package util

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func pluginProjectFixture(t *testing.T, original map[string]string) (context.Context, *PluginDevelopmentGrant) {
	t.Helper()
	oldWorkspace, oldData, oldConf := WorkspaceDir, DataDir, ConfDir
	WorkspaceDir = t.TempDir()
	DataDir = filepath.Join(WorkspaceDir, "data")
	ConfDir = filepath.Join(WorkspaceDir, "conf")
	t.Cleanup(func() { WorkspaceDir, DataDir, ConfDir = oldWorkspace, oldData, oldConf })
	grant := &PluginDevelopmentGrant{SessionID: "session", TaskID: "task123", PlanHash: "planhash", PlanVersion: 1, Frontend: "desktop", PackageName: "sample", AllowFiles: []string{"plugin.json", "index.js", "src/new.js"}}
	grant.SourceRoot = filepath.Join(PluginProjectRoot(grant.TaskID), "source")
	if original != nil {
		grant.SourcePath = "imports/sample"
		root := filepath.Join(WorkspaceDir, filepath.FromSlash(grant.SourcePath))
		if err := os.MkdirAll(root, 0700); err != nil {
			t.Fatal(err)
		}
		for name, data := range original {
			if err := os.MkdirAll(filepath.Dir(filepath.Join(root, name)), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, name), []byte(data), 0600); err != nil {
				t.Fatal(err)
			}
		}
		status, err := InspectPluginProjectSource(root, nil, grant.AllowFiles)
		if err != nil {
			t.Fatal(err)
		}
		grant.SourceRevision = status.SourceRevision
	}
	ctx := WithPluginDevelopmentAccess(context.Background(), func(string) (*PluginDevelopmentGrant, error) { return grant, nil })
	return ctx, grant
}

func TestPluginProjectPreparePreservesOriginalAndCheckpoint(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "old source", "plugin.json": "{}", "ignored.txt": "not approved"})
	status, err := PreparePluginProject(ctx, grant.TaskID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Prepared || len(status.Files) != 2 || status.SourceRevision != status.BaselineRevision {
		t.Fatalf("unexpected status: %+v", status)
	}
	if _, err = os.Stat(filepath.Join(grant.SourceRoot, "ignored.txt")); !os.IsNotExist(err) {
		t.Fatalf("unapproved import: %v", err)
	}
	if _, err = os.Stat(filepath.Join(grant.SourceRoot, "src")); err != nil {
		t.Fatal("missing approved parent", err)
	}
	if data, err := os.ReadFile(filepath.Join(WorkspaceDir, grant.SourcePath, "index.js")); err != nil || string(data) != "old source" {
		t.Fatal("original changed", err)
	}
	if data, err := os.ReadFile(filepath.Join(PluginProjectPrivateDir(grant.TaskID), "baseline", "index.js")); err != nil || string(data) != "old source" {
		t.Fatal("checkpoint absent", err)
	}
}

func TestPluginProjectImportConflictHasNoSourceSideEffects(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "old"})
	if err := os.WriteFile(filepath.Join(WorkspaceDir, grant.SourcePath, "index.js"), []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err == nil || !strings.Contains(err.Error(), "revision_conflict") {
		t.Fatal(err)
	}
	if _, err := os.Stat(PluginProjectRoot(grant.TaskID)); !os.IsNotExist(err) {
		t.Fatal("source created after conflict", err)
	}
	if _, err := os.Stat(PluginProjectPrivateDir(grant.TaskID)); !os.IsNotExist(err) {
		t.Fatal("checkpoint created before failed preflight", err)
	}
}

func TestPluginProjectCheckpointFailureStopsPrepare(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, nil)
	if err := os.MkdirAll(PluginProjectPrivateDir(grant.TaskID), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(PluginProjectPrivateDir(grant.TaskID), "baseline"), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err == nil || !strings.Contains(err.Error(), "backup_failed") {
		t.Fatal(err)
	}
	if _, err := os.Stat(grant.SourceRoot); !os.IsNotExist(err) {
		t.Fatal("source created despite checkpoint failure", err)
	}
}

func TestPluginProjectMutationRecoveryAndExternalConflict(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "old"})
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	err := WithPluginProjectSource(ctx, true, func(g *PluginDevelopmentGrant, root *os.Root) error {
		if err := BeginPluginProjectMutation(g, "index.js", PluginProjectDigest([]byte("old")), PluginProjectDigest([]byte("new"))); err != nil {
			return err
		}
		return root.WriteFile("index.js", []byte("new"), 0600)
	})
	if err != nil {
		t.Fatal(err)
	}
	status, err := GetPluginProjectStatus(ctx, grant.TaskID)
	if err != nil || !status.Pending {
		t.Fatal("missing pending journal", err)
	}
	if err := WithPluginProjectSource(ctx, true, func(*PluginDevelopmentGrant, *os.Root) error { return nil }); err == nil {
		t.Fatal("pending write accepted")
	}
	if err := os.WriteFile(filepath.Join(grant.SourceRoot, "index.js"), []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	status, err = GetPluginProjectStatus(ctx, grant.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := RestorePluginProject(ctx, grant.TaskID, status.SourceRevision); err == nil || !strings.Contains(err.Error(), "external edit") {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(filepath.Join(grant.SourceRoot, "index.js")); string(data) != "external" {
		t.Fatal("external edit overwritten")
	}
	if err := os.WriteFile(filepath.Join(grant.SourceRoot, "index.js"), []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	status, _ = GetPluginProjectStatus(ctx, grant.TaskID)
	restored, err := RestorePluginProject(ctx, grant.TaskID, status.SourceRevision)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Pending || restored.SourceRevision != restored.BaselineRevision {
		t.Fatal("restoration incomplete")
	}
	manifest, err := readPluginProjectManifest(grant)
	if err != nil || len(manifest.Journal) != 2 {
		t.Fatal("failure history not preserved", err)
	}
	if data, _ := os.ReadFile(filepath.Join(grant.SourceRoot, "index.js")); string(data) != "old" {
		t.Fatal("baseline not restored")
	}
}

func TestPluginProjectRenameJournalTracksBothSides(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "same"})
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	rev := PluginProjectDigest([]byte("same"))
	err := WithPluginProjectSource(ctx, true, func(g *PluginDevelopmentGrant, root *os.Root) error {
		if err := BeginPluginProjectMutations(g, map[string]PluginProjectMutation{"index.js": {rev, PluginProjectMissingRevision}, "src/new.js": {PluginProjectMissingRevision, rev}}); err != nil {
			return err
		}
		if err := root.Rename("index.js", "src/new.js"); err != nil {
			return err
		}
		return FinishPluginProjectMutations(g, []string{"index.js", "src/new.js"})
	})
	if err != nil {
		t.Fatal(err)
	}
	status, err := GetPluginProjectStatus(ctx, grant.TaskID)
	if err != nil || status.Pending || status.ExternalChanges {
		t.Fatal(status, err)
	}
	if _, err := RestorePluginProject(ctx, grant.TaskID, status.SourceRevision); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(grant.SourceRoot, "src/new.js")); !os.IsNotExist(err) {
		t.Fatal("renamed new path not removed", err)
	}
}

func TestPluginProjectMissingCheckpointStopsMutation(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "old"})
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(PluginProjectPrivateDir(grant.TaskID), "baseline", "index.js")); err != nil {
		t.Fatal(err)
	}
	called := false
	err := WithPluginProjectSource(ctx, true, func(*PluginDevelopmentGrant, *os.Root) error { called = true; return nil })
	if err == nil || !strings.Contains(err.Error(), "backup_failed") || called {
		t.Fatal("mutation proceeded without checkpoint", err)
	}
}

func TestPluginProjectUnsafeSnapshot(t *testing.T) {
	for _, kind := range []string{"symlink", "hardlink", "secret", "case", "size", "denied"} {
		t.Run(kind, func(t *testing.T) {
			_, grant := pluginProjectFixture(t, map[string]string{"index.js": "old"})
			rootPath := filepath.Join(WorkspaceDir, grant.SourcePath)
			var authorize func(string) error
			selected := []string{"index.js"}
			switch kind {
			case "symlink":
				selected = []string{"other.js"}
				if err := os.Symlink("index.js", filepath.Join(rootPath, "other.js")); err != nil {
					t.Skip(err)
				}
			case "hardlink":
				if err := os.Link(filepath.Join(rootPath, "index.js"), filepath.Join(rootPath, "other.js")); err != nil {
					t.Skip(err)
				}
			case "secret":
				selected = []string{".env"}
				if err := os.WriteFile(filepath.Join(rootPath, ".env"), []byte("secret"), 0600); err != nil {
					t.Fatal(err)
				}
			case "case":
				selected = []string{"index.js", "INDEX.JS"}
				if err := os.WriteFile(filepath.Join(rootPath, "INDEX.JS"), []byte("second"), 0600); err != nil {
					t.Fatal(err)
				}
				if list, _ := os.ReadDir(rootPath); len(list) < 2 {
					t.Skip("case-insensitive filesystem")
				}
			case "size":
				selected = []string{"large.bin"}
				f, err := os.Create(filepath.Join(rootPath, "large.bin"))
				if err != nil {
					t.Fatal(err)
				}
				if err = f.Truncate(PluginProjectMaxFileBytes + 1); err != nil {
					t.Fatal(err)
				}
				f.Close()
			case "denied":
				authorize = func(name string) error {
					if strings.HasSuffix(name, "index.js") {
						return errors.New("encrypted path denied")
					}
					return nil
				}
			}
			if _, err := InspectPluginProjectSource(rootPath, authorize, selected); err == nil {
				t.Fatal("unsafe snapshot accepted")
			}
		})
	}
}

func TestPluginProjectRequiresTrustedCurrentGrant(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, nil)
	if _, err := PreparePluginProject(context.Background(), grant.TaskID, nil); err == nil {
		t.Fatal("untrusted prepare accepted")
	}
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	grant.PlanHash = "new plan"
	status, err := GetPluginProjectStatus(ctx, grant.TaskID)
	if err != nil || !status.PlanMismatch {
		t.Fatal("new plan did not expose read-only replan status", err)
	}
	if err = WithPluginProjectSource(ctx, true, func(*PluginDevelopmentGrant, *os.Root) error { return nil }); err == nil {
		t.Fatal("unprepared new plan accepted writes")
	}
	if _, err = PreparePluginProject(ctx, grant.TaskID, nil, "stale"); err == nil {
		t.Fatal("stale replan accepted")
	}
	status, err = PreparePluginProject(ctx, grant.TaskID, nil, status.SourceRevision)
	if err != nil || status.PlanMismatch {
		t.Fatal("approved replan not prepared", err)
	}
}

func TestPluginProjectReplanPreservesCurrentSourceAndPriorCheckpoint(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "old"})
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	err := WithPluginProjectSource(ctx, true, func(g *PluginDevelopmentGrant, root *os.Root) error {
		if err := BeginPluginProjectMutation(g, "index.js", PluginProjectDigest([]byte("old")), PluginProjectDigest([]byte("new"))); err != nil {
			return err
		}
		if err := root.WriteFile("index.js", []byte("new"), 0600); err != nil {
			return err
		}
		return FinishPluginProjectMutation(g, "index.js")
	})
	if err != nil {
		t.Fatal(err)
	}
	grant.PlanHash = "plan version 2"
	grant.PlanVersion = 2
	status, err := GetPluginProjectStatus(ctx, grant.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = PreparePluginProject(ctx, grant.TaskID, nil, status.SourceRevision); err != nil {
		t.Fatal(err)
	}
	manifest, err := readPluginProjectManifest(grant)
	if err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(filepath.Join(grant.SourceRoot, "index.js")); string(data) != "new" {
		t.Fatal("replan overwrote current source")
	}
	if data, _ := os.ReadFile(filepath.Join(PluginProjectPrivateDir(grant.TaskID), "baseline", "index.js")); string(data) != "old" {
		t.Fatal("prior checkpoint lost")
	}
	if data, _ := os.ReadFile(filepath.Join(pluginProjectBaselinePath(grant, manifest), "index.js")); string(data) != "new" {
		t.Fatal("new checkpoint does not cover current code")
	}
}

func TestPluginProjectCrashTemporaryRecovery(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "old"})
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	tmp := ".text-file-recorded"
	err := WithPluginProjectSource(ctx, true, func(g *PluginDevelopmentGrant, root *os.Root) error {
		if err := BeginPluginProjectMutation(g, "index.js", PluginProjectDigest([]byte("old")), PluginProjectDigest([]byte("new")), tmp); err != nil {
			return err
		}
		return root.WriteFile(tmp, []byte("new"), 0600)
	})
	if err != nil {
		t.Fatal(err)
	}
	status, err := GetPluginProjectStatus(ctx, grant.TaskID)
	if err != nil || !status.Pending {
		t.Fatal("recorded crash temp prevents status", err)
	}
	if _, err = RestorePluginProject(ctx, grant.TaskID, status.SourceRevision); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(grant.SourceRoot, tmp)); !os.IsNotExist(err) {
		t.Fatal("verified temporary file not removed", err)
	}
	if data, _ := os.ReadFile(filepath.Join(grant.SourceRoot, "index.js")); string(data) != "old" {
		t.Fatal("original source changed")
	}
}

func TestPluginProjectCrashTemporaryUnknownPreserved(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "old"})
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	tmp := ".text-file-recorded"
	err := WithPluginProjectSource(ctx, true, func(g *PluginDevelopmentGrant, root *os.Root) error {
		if err := BeginPluginProjectMutation(g, "index.js", PluginProjectDigest([]byte("old")), PluginProjectDigest([]byte("new")), tmp); err != nil {
			return err
		}
		return root.WriteFile(tmp, []byte("incomplete"), 0600)
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = RestorePluginProject(ctx, grant.TaskID, "unused"); err == nil || !strings.Contains(err.Error(), "result_unknown") {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(filepath.Join(grant.SourceRoot, tmp)); string(data) != "incomplete" {
		t.Fatal("unknown temporary bytes removed")
	}
}

func TestPluginProjectCandidateExcludesRepositoryInternals(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "safe"})
	root := filepath.Join(WorkspaceDir, grant.SourcePath)
	for name, data := range map[string]string{".git/config": "private remote", "node_modules/package/index.js": "dependency", "config/token.json": "private token", "unapproved.txt": "outside selected inventory"} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(root, name)), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	discovery, err := InspectPluginProjectSource(root, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(discovery.Excluded) != 3 || len(discovery.Files) != 2 {
		t.Fatalf("unexpected discovery: %+v", discovery)
	}
	selected, err := InspectPluginProjectSource(root, nil, grant.AllowFiles)
	if err != nil {
		t.Fatal(err)
	}
	if selected.SourceRevision != grant.SourceRevision {
		t.Fatal("unselected repository files changed selected revision")
	}
	if _, err = PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(grant.SourceRoot, "unapproved.txt")); !os.IsNotExist(err) {
		t.Fatal("unapproved source imported", err)
	}
}

func TestPluginProjectInterruptedPreparationResumes(t *testing.T) {
	for _, cancelAt := range []int{2, 3} {
		t.Run(string(rune('0'+cancelAt)), func(t *testing.T) {
			ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "original"})
			checks := 0
			interrupted := WithPluginDevelopmentAccess(context.Background(), func(string) (*PluginDevelopmentGrant, error) {
				checks++
				if checks == cancelAt {
					return nil, context.Canceled
				}
				return grant, nil
			})
			if _, err := PreparePluginProject(interrupted, grant.TaskID, nil); err == nil {
				t.Fatal("cancellation did not interrupt prepare")
			}
			status, err := GetPluginProjectStatus(ctx, grant.TaskID)
			if err != nil || !status.Pending || status.Prepared {
				t.Fatal("preparation journal not readable", status, err)
			}
			stage := filepath.Join(PluginProjectRoot(grant.TaskID), ".prepare-source", "index.js")
			if _, err = os.Stat(stage); err == nil {
				if err = os.WriteFile(stage, []byte("partial"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			status, err = PreparePluginProject(ctx, grant.TaskID, nil)
			if err != nil || !status.Prepared || status.Pending {
				t.Fatal("preparation retry failed", status, err)
			}
			if data, _ := os.ReadFile(filepath.Join(grant.SourceRoot, "index.js")); string(data) != "original" {
				t.Fatal("retry did not use checkpoint bytes")
			}
		})
	}
}

func TestPluginProjectInterruptedReadyJournalResumes(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "original"})
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	manifest, err := readPluginProjectManifest(grant)
	if err != nil {
		t.Fatal(err)
	}
	manifest.Preparing = true
	manifest.Current = map[string]string{}
	if err = savePluginProjectManifest(grant, manifest); err != nil {
		t.Fatal(err)
	}
	if status, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil || !status.Prepared || status.Pending {
		t.Fatal("published source could not finish ready journal", status, err)
	}
}

func TestPluginProjectInterruptedReplanAndProvenance(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "original"})
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	status, _ := GetPluginProjectStatus(ctx, grant.TaskID)
	grant.PlanHash = "new plan"
	grant.PlanVersion++
	checks := 0
	interrupted := WithPluginDevelopmentAccess(context.Background(), func(string) (*PluginDevelopmentGrant, error) {
		checks++
		if checks == 2 {
			return nil, context.Canceled
		}
		return grant, nil
	})
	if _, err := PreparePluginProject(interrupted, grant.TaskID, nil, status.SourceRevision); err == nil {
		t.Fatal("replan cancellation did not trigger")
	}
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil, status.SourceRevision); err != nil {
		t.Fatal("complete checkpoint could not be reused", err)
	}
	grant.PlanHash = "another plan"
	grant.SourcePath = "imports/other"
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil, status.SourceRevision); err == nil || !strings.Contains(err.Error(), "provenance") {
		t.Fatal("changed provenance silently ignored", err)
	}
}

func TestPluginProjectRecoveryOnlyCannotGrantOrdinaryWrites(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, map[string]string{"index.js": "old"})
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	err := WithPluginProjectSource(ctx, true, func(g *PluginDevelopmentGrant, root *os.Root) error {
		if err := BeginPluginProjectMutation(g, "index.js", PluginProjectDigest([]byte("old")), PluginProjectDigest([]byte("new"))); err != nil {
			return err
		}
		return root.WriteFile("index.js", []byte("new"), 0600)
	})
	if err != nil {
		t.Fatal(err)
	}
	confirmed := true
	recoveryCtx := WithPluginDevelopmentAccess(context.Background(), func(operation string) (*PluginDevelopmentGrant, error) {
		switch operation {
		case "read":
			return grant, nil
		case "recover":
			if confirmed {
				return grant, nil
			}
		case "recovered":
			confirmed = false
			return grant, nil
		}
		return nil, errors.New("ordinary plan is not approved")
	})
	status, err := GetPluginProjectStatus(recoveryCtx, grant.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = PreparePluginProject(recoveryCtx, grant.TaskID, nil, status.SourceRevision); err == nil {
		t.Fatal("recovery-only grant replanned an existing source")
	}
	if _, err = RestorePluginProject(recoveryCtx, grant.TaskID, status.SourceRevision); err != nil {
		t.Fatal(err)
	}
	if confirmed {
		t.Fatal("one-shot recovery grant was not consumed")
	}
	if err = WithPluginProjectSource(recoveryCtx, true, func(*PluginDevelopmentGrant, *os.Root) error { return nil }); err == nil {
		t.Fatal("recovery approval granted normal source write")
	}
}

func TestPluginProjectRecoveryOnlyResumesPreparation(t *testing.T) {
	_, grant := pluginProjectFixture(t, map[string]string{"index.js": "old"})
	checks := 0
	interrupted := WithPluginDevelopmentAccess(context.Background(), func(string) (*PluginDevelopmentGrant, error) {
		checks++
		if checks == 2 {
			return nil, context.Canceled
		}
		return grant, nil
	})
	if _, err := PreparePluginProject(interrupted, grant.TaskID, nil); err == nil {
		t.Fatal("prepare did not interrupt")
	}
	confirmed := true
	recoveryCtx := WithPluginDevelopmentAccess(context.Background(), func(operation string) (*PluginDevelopmentGrant, error) {
		if operation == "recover" && confirmed {
			return grant, nil
		}
		if operation == "recovered" {
			confirmed = false
			return grant, nil
		}
		if operation == "read" {
			return grant, nil
		}
		return nil, errors.New("ordinary plan is not approved")
	})
	if status, err := PreparePluginProject(recoveryCtx, grant.TaskID, nil); err != nil || !status.Prepared {
		t.Fatal(status, err)
	}
	if confirmed {
		t.Fatal("preparation recovery did not consume permit")
	}
	if err := WithPluginProjectSource(recoveryCtx, true, func(*PluginDevelopmentGrant, *os.Root) error { return nil }); err == nil {
		t.Fatal("preparation recovery allowed normal writes")
	}
}

func TestPluginProjectLinkedCreationCrashPreservesExactPair(t *testing.T) {
	ctx, grant := pluginProjectFixture(t, nil)
	if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
		t.Fatal(err)
	}
	tmp := ".text-file-created"
	content := []byte("created before crash")
	err := WithPluginProjectSource(ctx, true, func(g *PluginDevelopmentGrant, root *os.Root) error {
		if err := BeginPluginProjectMutation(g, "index.js", PluginProjectMissingRevision, PluginProjectDigest(content), tmp); err != nil {
			return err
		}
		if err := root.WriteFile(tmp, content, 0600); err != nil {
			return err
		}
		return root.Link(tmp, "index.js")
	})
	if err != nil {
		t.Fatal(err)
	}
	journalBefore, err := os.ReadFile(filepath.Join(PluginProjectPrivateDir(grant.TaskID), "project.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = GetPluginProjectStatus(ctx, grant.TaskID); err == nil || !strings.Contains(err.Error(), "result_unknown") || !strings.Contains(err.Error(), "manual inspection") {
		t.Fatal("crash state was not reported as unknown", err)
	}
	if err = WithPluginProjectSource(ctx, true, func(*PluginDevelopmentGrant, *os.Root) error { return nil }); err == nil {
		t.Fatal("pending linked pair entered ordinary write")
	}
	if _, err = RestorePluginProject(ctx, grant.TaskID, PluginProjectTreeRevision(map[string]string{"index.js": PluginProjectDigest(content)})); err == nil || !strings.Contains(err.Error(), "result_unknown") {
		t.Fatal("hardlink pair was automatically restored", err)
	}
	for _, name := range []string{tmp, "index.js"} {
		if data, readErr := os.ReadFile(filepath.Join(grant.SourceRoot, name)); readErr != nil || string(data) != string(content) {
			t.Fatal("crash pair bytes were changed", name, readErr)
		}
	}
	first, _ := os.Lstat(filepath.Join(grant.SourceRoot, tmp))
	second, _ := os.Lstat(filepath.Join(grant.SourceRoot, "index.js"))
	if !os.SameFile(first, second) {
		t.Fatal("recorded hardlink pair was changed")
	}
	journalAfter, err := os.ReadFile(filepath.Join(PluginProjectPrivateDir(grant.TaskID), "project.json"))
	if err != nil || string(journalAfter) != string(journalBefore) {
		t.Fatal("crash journal was changed", err)
	}
}

func TestPluginProjectLinkedCreationRejectsThirdAliasAndChangedBytes(t *testing.T) {
	for _, kind := range []string{"third-alias", "changed-bytes"} {
		t.Run(kind, func(t *testing.T) {
			ctx, grant := pluginProjectFixture(t, nil)
			if _, err := PreparePluginProject(ctx, grant.TaskID, nil); err != nil {
				t.Fatal(err)
			}
			tmp := ".text-file-created"
			content := []byte("created")
			err := WithPluginProjectSource(ctx, true, func(g *PluginDevelopmentGrant, root *os.Root) error {
				if err := BeginPluginProjectMutation(g, "index.js", PluginProjectMissingRevision, PluginProjectDigest(content), tmp); err != nil {
					return err
				}
				if err := root.WriteFile(tmp, content, 0600); err != nil {
					return err
				}
				return root.Link(tmp, "index.js")
			})
			if err != nil {
				t.Fatal(err)
			}
			if kind == "third-alias" {
				if err = os.Link(filepath.Join(grant.SourceRoot, tmp), filepath.Join(grant.SourceRoot, "other.js")); err != nil {
					t.Fatal(err)
				}
			} else {
				if err = os.WriteFile(filepath.Join(grant.SourceRoot, tmp), []byte("external change"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err = GetPluginProjectStatus(ctx, grant.TaskID); err == nil {
				t.Fatal("unknown hardlink state accepted")
			}
			if _, err = RestorePluginProject(ctx, grant.TaskID, "not used"); err == nil {
				t.Fatal("unknown hardlink state restored")
			}
			if _, err = os.Stat(filepath.Join(grant.SourceRoot, tmp)); err != nil {
				t.Fatal("unknown temp was removed", err)
			}
		})
	}
}
