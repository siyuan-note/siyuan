package util

import (
	"bytes"
	"io/fs"
	"os"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
	"unicode"
)

func TestBuiltinSkillMetadataAndResources(t *testing.T) {
	workspace, user := setSkillTestRoots(t)
	first, err := BuiltinPluginSkill(nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuiltinPluginSkill(nil)
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatalf("unstable metadata: %+v, %+v, %v", first, second, err)
	}
	if first.ID != "builtin:siyuan-plugin-development" || first.Source != "builtin" || !first.Enabled || first.Version == "" || !strings.HasPrefix(first.Digest, "sha256:") || len(first.Digest) != 71 {
		t.Fatalf("incomplete metadata: %+v", first)
	}
	loaded, err := LoadBuiltinSkill(first.Name, nil)
	if err != nil || loaded.SkillDir != "" || loaded.Digest != first.Digest || loaded.Version != first.Version || len(loaded.Resources) < 3 {
		t.Fatalf("load failed: %+v, %v", loaded, err)
	}
	if len(loaded.Content) >= MaxToolOutputChars || strings.HasPrefix(loaded.Content, "---") {
		t.Fatalf("invalid root body")
	}
	for _, resource := range loaded.Resources {
		result, readErr := LoadBuiltinSkill(first.Name+"/"+resource, nil)
		if readErr != nil || result.ResourcePath != resource || result.Content == "" || result.Digest != first.Digest {
			t.Fatalf("resource %s: %+v, %v", resource, result, readErr)
		}
	}
	for _, dir := range []string{workspace, user} {
		if _, err = os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("builtin discovery wrote directory %s: %v", dir, err)
		}
	}
}

func TestBuiltinSkillEnglishMarkdownKeepsMetadataBinding(t *testing.T) {
	info, err := BuiltinPluginSkill(nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(info.Description, "Official frontend plugin development workflow") {
		t.Fatal("builtin metadata description is not in English", info.Description)
	}
	for _, resource := range []string{"SKILL.md", "references/development.md", "references/verification.md"} {
		loaded, err := LoadBuiltinSkill(PluginDevelopmentSkillName+"/"+resource, nil)
		if err != nil {
			t.Fatal(err)
		}
		if loaded.Digest != info.Digest || loaded.Version != info.Version {
			t.Fatalf("resource metadata differs from current content binding: %s", resource)
		}
		if strings.ContainsFunc(loaded.Content, func(r rune) bool { return unicode.Is(unicode.Han, r) }) {
			t.Fatalf("builtin Markdown still contains untranslated Chinese: %s", resource)
		}
	}
}

func TestBuiltinSkillDisabledAndExactNames(t *testing.T) {
	info, err := BuiltinPluginSkill([]string{BuiltinPluginSkillID, "builtin:future"})
	if err != nil || info.Enabled {
		t.Fatalf("disabled metadata: %+v, %v", info, err)
	}
	for _, locator := range []string{PluginDevelopmentSkillName, PluginDevelopmentSkillName + "/SKILL.md", PluginDevelopmentSkillName + "/references/development.md"} {
		if _, err = LoadBuiltinSkill(locator, []string{BuiltinPluginSkillID}); err == nil {
			t.Fatalf("disabled builtin loaded: %s", locator)
		}
	}
	for _, locator := range []string{BuiltinPluginSkillID, " " + PluginDevelopmentSkillName, strings.ToUpper(PluginDevelopmentSkillName), PluginDevelopmentSkillName + "/", PluginDevelopmentSkillName + "/../SKILL.md", PluginDevelopmentSkillName + "/references/../SKILL.md", PluginDevelopmentSkillName + `/references\development.md`, PluginDevelopmentSkillName + "//SKILL.md", PluginDevelopmentSkillName + "/C:/SKILL.md", PluginDevelopmentSkillName + "/references"} {
		if _, err = LoadBuiltinSkill(locator, nil); err == nil {
			t.Fatalf("invalid builtin locator accepted: %q", locator)
		}
	}
}

func TestBuiltinSkillDoesNotShadowOrdinaryNames(t *testing.T) {
	workspace, user := setSkillTestRoots(t)
	writeSkill(t, user, PluginDevelopmentSkillName, PluginDevelopmentSkillName, "user", "user body")
	loaded, err := LoadSkill(PluginDevelopmentSkillName, []string{PluginDevelopmentSkillName})
	if err != nil || loaded.Content != "user body" || loaded.Source != "" {
		t.Fatalf("user resolution changed: %+v, %v", loaded, err)
	}
	writeSkill(t, workspace, PluginDevelopmentSkillName, PluginDevelopmentSkillName, "workspace", "workspace body")
	loaded, err = LoadSkill(PluginDevelopmentSkillName, []string{PluginDevelopmentSkillName})
	if err != nil || loaded.Content != "workspace body" || loaded.Source != "" {
		t.Fatalf("workspace priority changed: %+v, %v", loaded, err)
	}
	skills := DiscoverSkills([]string{PluginDevelopmentSkillName})
	if len(skills) != 1 || skills[0].Description != "workspace" {
		t.Fatalf("builtin polluted ordinary discovery: %+v", skills)
	}
}

func TestBuiltinSkillTextBounds(t *testing.T) {
	files := fstest.MapFS{
		"valid.txt":   {Data: []byte("valid UTF-8 文本")},
		"invalid.txt": {Data: []byte{0xff}},
		"binary.txt":  {Data: []byte{'a', 0}},
		"large.txt":   {Data: bytes.Repeat([]byte{'a'}, maxBuiltinSkillTextBytes+1)},
		"link":        {Data: []byte("valid.txt"), Mode: fs.ModeSymlink},
	}
	if _, err := readBuiltinSkillText(files, "valid.txt"); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"invalid.txt", "binary.txt", "large.txt", "link", "../valid.txt", "/valid.txt", ".", "a/../valid.txt"} {
		if _, err := readBuiltinSkillText(files, name); err == nil {
			t.Errorf("invalid resource accepted: %s", name)
		}
	}
}
