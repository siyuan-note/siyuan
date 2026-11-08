// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/bazaar"
)

func TestBazaarUpdateBatchCancellationKeepsCommittedPackages(t *testing.T) {
	setupSyncMutationTest(t)
	changes := captureBazaarChanges(t)
	previous := installBazaarUpdate
	t.Cleanup(func() { installBazaarUpdate = previous })
	root := t.TempDir()
	for _, name := range []string{"first", "second", "third"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("old"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var calls []string
	installBazaarUpdate = func(requestCtx context.Context, pkgType, repoURL, repoHash, repoRef, packageName string) (installMeta, error) {
		if requestCtx != ctx {
			t.Fatal("batch download did not receive the caller context")
		}
		calls = append(calls, packageName)
		if packageName == "second" {
			cancel()
			return installMeta{}, context.Canceled
		}
		if err := os.WriteFile(filepath.Join(root, packageName), []byte("new"), 0600); err != nil {
			t.Fatal(err)
		}
		return installMeta{}, nil
	}
	var packages []*UpdatedPackage
	for _, name := range []string{"first", "second", "third"} {
		packages = append(packages, &UpdatedPackage{Available: &bazaar.Package{Name: name}})
	}
	success, failed := 0, 0
	err := updatePackages(ctx, packages, "widgets", &success, &failed, len(packages))
	if !errors.Is(err, context.Canceled) || success != 1 || failed != 0 {
		t.Fatalf("canceled batch = %v, success=%d failed=%d", err, success, failed)
	}
	if !reflect.DeepEqual(calls, []string{"first", "second"}) {
		t.Fatalf("canceled batch continued downloading: %v", calls)
	}
	for name, expected := range map[string]string{"first": "new", "second": "old", "third": "old"} {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err != nil || string(data) != expected {
			t.Fatalf("package %s = %q, %v", name, data, err)
		}
	}
	if !reflect.DeepEqual(*changes, []string{"widgets"}) {
		t.Fatalf("committed packages were not refreshed after cancellation: %v", *changes)
	}
}

func TestBazaarUpdateBatchRetainsFailureCountsAndSingleRefresh(t *testing.T) {
	setupSyncMutationTest(t)
	changes := captureBazaarChanges(t)
	previous := installBazaarUpdate
	t.Cleanup(func() { installBazaarUpdate = previous })
	calls := 0
	installBazaarUpdate = func(context.Context, string, string, string, string, string) (installMeta, error) {
		calls++
		if calls == 1 {
			return installMeta{}, errors.New("network failure")
		}
		return installMeta{}, nil
	}
	packages := []*UpdatedPackage{{Available: &bazaar.Package{Name: "first"}}, {Available: &bazaar.Package{Name: "second"}}}
	success, failed := 0, 0
	if err := updatePackages(context.Background(), packages, "widgets", &success, &failed, len(packages)); err != nil {
		t.Fatal(err)
	}
	if success != 1 || failed != 1 || !reflect.DeepEqual(*changes, []string{"widgets"}) {
		t.Fatalf("batch outcome changed: success=%d failed=%d changes=%v", success, failed, *changes)
	}
}

func TestBazaarUpdateCanceledBeforeQuery(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, err := range []error{
		UpdateBazaarPackageContext(ctx, "plugins", "sample", "desktop"),
		BatchUpdatePackagesContext(ctx, "desktop"),
	} {
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled update queried packages: %v", err)
		}
	}
}

func TestBazaarBatchExclusionsDoNotRemoveUpdateDiscovery(t *testing.T) {
	packages := []*UpdatedPackage{
		{Installed: &bazaar.Package{Name: "sample"}, Available: &bazaar.Package{Name: "sample"}},
		{Installed: &bazaar.Package{Name: "other"}, Available: &bazaar.Package{Name: "other"}},
		{Available: &bazaar.Package{Name: "incompatible", DisallowUpdate: true}},
	}
	exclusions := map[string]map[string]bool{"plugins": {"sample": true}, "themes": {"other": true}, "widgets": {}, "icons": {"sample": true}, "templates": {"sample": true, "other": true}}
	for pkgType, names := range exclusions {
		filtered := excludeBazaarBatchPackages(packages, names)
		for _, pkg := range filtered {
			for name := range names {
				if pkg.Available.Name == name {
					t.Fatalf("%s retained excluded package %s", pkgType, name)
				}
			}
		}
		updatable, incompatible := filterUpdatableBazaarPackages(filtered)
		if incompatible != 1 || len(updatable) != 2-len(names) {
			t.Fatalf("%s changed compatibility counts: %d, %#v", pkgType, incompatible, updatable)
		}
	}
	if len(packages) != 3 || packages[0].Available.Name != "sample" || packages[0].Available.DisallowUpdate {
		t.Fatal("batch exclusions changed shared update entries or manual eligibility")
	}
	if len(excludeBazaarBatchPackages(packages, nil)) != 3 {
		t.Fatal("empty exclusions removed updates")
	}
	mismatched := []*UpdatedPackage{{Installed: &bazaar.Package{Name: "installed"}, Available: &bazaar.Package{Name: "online"}}}
	if len(excludeBazaarBatchPackages(mismatched, map[string]bool{"installed": true})) != 0 || len(excludeBazaarBatchPackages(mismatched, map[string]bool{"online": true})) != 1 {
		t.Fatal("exclusion did not use the installed package identity")
	}
}
