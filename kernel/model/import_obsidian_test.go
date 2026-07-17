// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestAnalyzeObsidianVault(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, ".obsidian"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Note.md"), []byte("![[image.png]]\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "image.png"), []byte("image"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "archive.zip"), []byte("archive"), 0644); err != nil {
		t.Fatal(err)
	}
	vault, err := analyzeObsidianVault(context.Background(), root, func(int, string) {})
	if err != nil {
		t.Fatal(err)
	}
	if vault.Analysis.MarkdownCount != 1 || vault.Analysis.ImportableAssetCount != 2 || vault.Analysis.ImportableAssetSize != 12 ||
		vault.Analysis.UnreferencedFileCount != 1 {
		t.Fatalf("分析统计不正确：%+v", vault.Analysis)
	}
	if len(vault.ImportAssets) != 2 || vault.ImportAssets[obsidianPathKey("archive.zip")] == nil {
		t.Fatalf("未引用资源文件未加入导入计划：%+v", vault.ImportAssets)
	}
	if vault.Analysis.SkippedHiddenCount != 0 {
		t.Fatalf("Vault 配置目录不应计入跳过路径：%d", vault.Analysis.SkippedHiddenCount)
	}
}

func TestRevalidateObsidianVaultDetectsAttachmentListChanges(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, ".obsidian"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Note.md"), []byte("content\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "archive.zip"), []byte("archive"), 0644); err != nil {
		t.Fatal(err)
	}
	vault, err := analyzeObsidianVault(context.Background(), root, func(int, string) {})
	if err != nil {
		t.Fatal(err)
	}
	if err = revalidateObsidianVault(context.Background(), vault); err != nil {
		t.Fatalf("未变更的 Vault 重新校验失败：%v", err)
	}
	if err = os.WriteFile(filepath.Join(root, "added.pdf"), []byte("added"), 0644); err != nil {
		t.Fatal(err)
	}
	if err = revalidateObsidianVault(context.Background(), vault); err == nil || !strings.Contains(err.Error(), "attachment file list changed") {
		t.Fatalf("资源文件列表变更未被检出：%v", err)
	}
}

func TestObsidianVaultValidationErrors(t *testing.T) {
	notDirectory := filepath.Join(t.TempDir(), "vault.md")
	if err := os.WriteFile(notDirectory, []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := validateObsidianVaultRoot(notDirectory); !errors.Is(err, errObsidianVaultNotDirectory) || obsidianVaultErrorLanguage(err) != 337 {
		t.Fatalf("unexpected non-directory error: %v", err)
	}

	missingConfig := t.TempDir()
	if _, err := validateObsidianVaultRoot(missingConfig); !errors.Is(err, errObsidianVaultConfigMissing) || obsidianVaultErrorLanguage(err) != 339 {
		t.Fatalf("unexpected missing config error: %v", err)
	}

	missingMarkdown := t.TempDir()
	if err := os.Mkdir(filepath.Join(missingMarkdown, ".obsidian"), 0755); err != nil {
		t.Fatal(err)
	}
	_, err := analyzeObsidianVault(context.Background(), missingMarkdown, func(int, string) {})
	if !errors.Is(err, errObsidianVaultMarkdownMissing) || obsidianVaultErrorLanguage(err) != 340 {
		t.Fatalf("unexpected missing Markdown error: %v", err)
	}
}

func TestIsObsidianImportableFileMode(t *testing.T) {
	if !isObsidianImportableFileMode(0644) {
		t.Fatal("普通文件应允许导入")
	}
	for _, mode := range []os.FileMode{os.ModeDir, os.ModeNamedPipe, os.ModeSocket, os.ModeDevice, os.ModeCharDevice, os.ModeIrregular} {
		if isObsidianImportableFileMode(mode) {
			t.Fatalf("特殊文件不应允许导入：%v", mode)
		}
	}
}

func TestScanObsidianSourceContexts(t *testing.T) {
	source := []byte("---\ntitle: [[YAML]]\n---\n[[Note]] %% [[Commented]] %%\n`[[Code]]`\n```md\n[[Fence]]\n```\n\n    [[IndentedCode]]\n\n![[image.png|100]]\nParagraph ^block-id\n%%unclosed\n")
	scan := scanObsidianSource(source)
	if len(scan.Wikis) != 2 {
		t.Fatalf("expected 2 Wikilinks, got %d", len(scan.Wikis))
	}
	if scan.Wikis[0].Target != "Note" || scan.Wikis[0].Embed {
		t.Fatalf("unexpected first Wikilink: %#v", scan.Wikis[0])
	}
	if scan.Wikis[1].Target != "image.png" || !scan.Wikis[1].Embed || scan.Wikis[1].Alias != "100" {
		t.Fatalf("unexpected image embed: %#v", scan.Wikis[1])
	}
	if len(scan.Comments) != 1 {
		t.Fatalf("unclosed comments must remain ordinary text, got %d comments", len(scan.Comments))
	}
	if len(scan.BlockIDs) != 1 || scan.BlockIDs[0] != "block-id" {
		t.Fatalf("unexpected block IDs: %#v", scan.BlockIDs)
	}
}

func TestScanObsidianSourceHTMLContexts(t *testing.T) {
	data := []byte("<span data-link=\"[[attr]]\">[[inline]]</span> [[outside]]\n<div>\n[[block]]\n</div>\n<!-- [[comment]] -->")
	scan := scanObsidianSource(data)
	if len(scan.Wikis) != 1 || scan.Wikis[0].Target != "outside" {
		t.Fatalf("HTML 中的语法不应参与转换：%+v", scan.Wikis)
	}
}

func TestPlanObsidianDocumentsUsesSameNameDocumentAsParent(t *testing.T) {
	vault := &obsidianVaultContext{
		Files: map[string]*obsidianSourceFile{}, DocsByRel: map[string]*obsidianDocPlan{},
		DocsByBase: map[string][]*obsidianDocPlan{}, Analysis: &ObsidianVaultAnalysis{},
	}
	for _, rel := range []string{"Project.md", "Project/Child.md", "Root.md"} {
		vault.Files[obsidianPathKey(rel)] = &obsidianSourceFile{RelPath: rel, IsMD: true}
	}
	if err := planObsidianDocuments(context.Background(), vault); err != nil {
		t.Fatal(err)
	}
	project := vault.DocsByRel[obsidianPathKey("Project")]
	child := vault.DocsByRel[obsidianPathKey("Project/Child")]
	root := vault.DocsByRel[obsidianPathKey("Root")]
	if project == nil || child == nil || root == nil {
		t.Fatalf("planned documents are incomplete: project=%v child=%v root=%v", project, child, root)
	}
	if vault.Analysis.SyntheticParentCount != 0 {
		t.Fatalf("same-name Markdown must avoid a synthetic parent, got %d", vault.Analysis.SyntheticParentCount)
	}
	if project.TargetPath != "/"+project.ID+".sy" {
		t.Fatalf("unexpected project target path: %s", project.TargetPath)
	}
	if child.TargetPath != "/"+project.ID+"/"+child.ID+".sy" {
		t.Fatalf("unexpected child target path: %s", child.TargetPath)
	}
	if root.TargetPath != "/"+root.ID+".sy" {
		t.Fatalf("unexpected root target path: %s", root.TargetPath)
	}
}

func TestResolveObsidianTarget(t *testing.T) {
	current := newObsidianTestDoc("Folder/Current")
	note := newObsidianTestDoc("Note")
	headingID := ast.NewNodeID()
	blockID := ast.NewNodeID()
	note.HeadingByText["section"] = []string{headingID}
	note.HeadingByChain["section"] = []string{headingID}
	note.BlockIDs["block"] = blockID
	assetSource := &obsidianSourceFile{RelPath: "Folder/image.png"}
	asset := &obsidianAssetPlan{Source: assetSource, FinalName: "image-id.png"}
	vault := &obsidianVaultContext{
		DocsByRel:  map[string]*obsidianDocPlan{obsidianPathKey(current.RelPath): current, obsidianPathKey(note.RelPath): note},
		DocsByBase: map[string][]*obsidianDocPlan{"current": {current}, "note": {note}},
		Assets:     map[string]*obsidianAssetPlan{obsidianPathKey(assetSource.RelPath): asset},
	}

	for target, expectedID := range map[string]string{"Note": note.ID, "Note#Section": headingID, "Note#^block": blockID} {
		resolved := resolveObsidianTarget(vault, current, target)
		if resolved.Status != "resolved" || resolved.ID != expectedID {
			t.Fatalf("resolve %q returned %#v", target, resolved)
		}
	}
	resolvedAsset := resolveObsidianTarget(vault, current, "image.png")
	if resolvedAsset.Status != "resolved" || resolvedAsset.Asset != asset {
		t.Fatalf("resolve image returned %#v", resolvedAsset)
	}
}

func TestResolveObsidianAmbiguousTargetUsesFirstMatch(t *testing.T) {
	current := newObsidianTestDoc("Current")
	first := newObsidianTestDoc("A/Note")
	second := newObsidianTestDoc("B/Note")
	firstHeadingID, secondHeadingID := ast.NewNodeID(), ast.NewNodeID()
	first.HeadingByText["section"] = []string{firstHeadingID, secondHeadingID}
	first.BlockIDs["duplicate"] = ast.NewNodeID()
	first.DuplicateBlocks["duplicate"] = true
	firstAsset := &obsidianAssetPlan{Source: &obsidianSourceFile{RelPath: "A/image.png"}}
	secondAsset := &obsidianAssetPlan{Source: &obsidianSourceFile{RelPath: "B/image.png"}}
	vault := &obsidianVaultContext{
		DocsByRel: map[string]*obsidianDocPlan{
			obsidianPathKey(current.RelPath): current,
			obsidianPathKey(first.RelPath):   first,
			obsidianPathKey(second.RelPath):  second,
		},
		DocsByBase: map[string][]*obsidianDocPlan{"note": {second, first}},
		Assets: map[string]*obsidianAssetPlan{
			obsidianPathKey(firstAsset.Source.RelPath):  firstAsset,
			obsidianPathKey(secondAsset.Source.RelPath): secondAsset,
		},
	}

	for target, expectedID := range map[string]string{
		"Note":              first.ID,
		"A/Note#Section":    firstHeadingID,
		"A/Note#^duplicate": first.BlockIDs["duplicate"],
	} {
		resolved := resolveObsidianTarget(vault, current, target)
		if resolved.Status != "resolved" || !resolved.Ambiguous || resolved.ID != expectedID {
			t.Fatalf("ambiguous target %q returned %#v", target, resolved)
		}
	}
	resolvedAsset := resolveObsidianTarget(vault, current, "image.png")
	if resolvedAsset.Status != "resolved" || !resolvedAsset.Ambiguous || resolvedAsset.Asset != firstAsset {
		t.Fatalf("ambiguous asset returned %#v", resolvedAsset)
	}
}

func TestInjectObsidianDuplicateBlockIDUsesFirstMatch(t *testing.T) {
	doc := newObsidianTestDoc("Current")
	doc.BlockIDs["duplicate"] = ast.NewNodeID()
	doc.DuplicateBlocks["duplicate"] = true
	transformed := string(injectObsidianBlockIAL([]byte("First ^duplicate\n\nSecond ^duplicate\n"), doc))
	ial := "{: id=\"" + doc.BlockIDs["duplicate"] + "\"}"
	if strings.Count(transformed, ial) != 1 || !strings.Contains(transformed, "First\n"+ial) || strings.Contains(transformed, "Second\n"+ial) {
		t.Fatalf("the first duplicate block ID was not selected:\n%s", transformed)
	}
}

func TestTransformAndParseObsidianMarkdown(t *testing.T) {
	current := newObsidianTestDoc("Current")
	current.TargetPath = "/" + current.ID + ".sy"
	current.HPath = "/Current"
	current.BlockIDs["paragraph"] = ast.NewNodeID()
	note := newObsidianTestDoc("Note")
	headingID := ast.NewNodeID()
	note.HeadingByText["section"] = []string{headingID}
	note.HeadingByChain["section"] = []string{headingID}
	assetSource := &obsidianSourceFile{RelPath: "image.png"}
	asset := &obsidianAssetPlan{Source: assetSource, FinalName: "image-" + ast.NewNodeID() + ".png"}
	pdfSource := &obsidianSourceFile{RelPath: "file.pdf"}
	pdf := &obsidianAssetPlan{Source: pdfSource, FinalName: "file-" + ast.NewNodeID() + ".pdf"}
	vault := &obsidianVaultContext{
		DocsByRel:  map[string]*obsidianDocPlan{obsidianPathKey(current.RelPath): current, obsidianPathKey(note.RelPath): note},
		DocsByBase: map[string][]*obsidianDocPlan{"current": {current}, "note": {note}},
		Assets: map[string]*obsidianAssetPlan{
			obsidianPathKey(assetSource.RelPath): asset,
			obsidianPathKey(pdfSource.RelPath):   pdf,
		},
	}
	source := []byte("[[Note|Alias]]\n\n[[Note]]\n\n[[Note#Section]]\n\n![[Note#Section]]\n\n![[image.png|100]]\n\n[Section](Note.md#Section)\n\n![PDF](file.pdf)\n\n%%secret%%\n\nParagraph ^paragraph\n\nText[^note]\n\n[^note]: Footnote text\n")
	transformed, stats := transformObsidianMarkdown(vault, current, source)
	transformedText := string(transformed)
	footnoteMatch := regexp.MustCompile(`\(\((\d{14}-[a-z0-9]{7}) "\[1\]"\)\)`).FindStringSubmatch(transformedText)
	if len(footnoteMatch) != 2 {
		t.Fatalf("脚注引用未转换为静态块引用：\n%s", transformedText)
	}
	footnoteID := footnoteMatch[1]
	for _, expected := range []string{"((" + note.ID + " \"Alias\"))", "((" + note.ID + " 'Note'))", "((" + headingID + " 'Section'))", "{{SELECT * FROM blocks WHERE id = '" + headingID + "'}}", "assets/" + asset.FinalName, "width: 100px", "{: id=\"" + current.BlockIDs["paragraph"] + "\"}"} {
		if !strings.Contains(transformedText, expected) {
			t.Fatalf("transformed Markdown does not contain %q:\n%s", expected, transformedText)
		}
	}
	if !strings.Contains(transformedText, "%%secret%%") {
		t.Fatalf("注释没有原样保留：\n%s", transformedText)
	}
	if stats.ConvertedLinks != 4 || stats.ConvertedEmbeds != 1 || stats.ConvertedFootnotes != 1 || stats.PreservedComments != 1 {
		t.Fatalf("unexpected transform stats: %#v", stats)
	}

	tree, err := parseObsidianMd(transformed, vault, current, stats)
	if err != nil {
		t.Fatal(err)
	}
	var blockRefs, dynamicBlockRefs, embeds, images, links int
	var foundParagraphID, foundFootnoteID, foundSuperscriptFootnote bool
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if treenode.IsBlockRef(node) {
			blockRefs++
			if node.TextMarkBlockRefSubtype == "d" {
				dynamicBlockRefs++
			}
		}
		if node.Type == ast.NodeBlockQueryEmbed && treenode.GetEmbedBlockRef(node) == headingID {
			embeds++
		}
		if node.Type == ast.NodeImage {
			images++
		}
		if node.Type == ast.NodeLink {
			links++
		}
		if node.ID == current.BlockIDs["paragraph"] {
			foundParagraphID = true
		}
		if node.ID == footnoteID {
			foundFootnoteID = true
		}
		if node.IsTextMarkType("sup") && treenode.IsBlockRef(node) && node.TextMarkBlockRefID == footnoteID {
			foundSuperscriptFootnote = true
		}
		return ast.WalkContinue
	})
	if blockRefs < 5 {
		t.Fatalf("expected document, Markdown and footnote block refs, got %d", blockRefs)
	}
	if dynamicBlockRefs != 2 || embeds != 1 || images != 1 || links < 1 || !foundParagraphID || !foundFootnoteID || !foundSuperscriptFootnote {
		t.Fatalf("unexpected parsed tree: dynamicBlockRefs=%d embeds=%d images=%d links=%d paragraphID=%v footnoteID=%v superscriptFootnote=%v", dynamicBlockRefs, embeds, images, links, foundParagraphID, foundFootnoteID, foundSuperscriptFootnote)
	}
}

func TestObsidianBlockIDsOnStructuredBlocks(t *testing.T) {
	doc := newObsidianTestDoc("Current")
	doc.TargetPath = "/" + doc.ID + ".sy"
	doc.HPath = "/Current"
	source := []byte("# Heading ^heading\n\n- Item ^item\n\n- [?] Task ^task\n\n> Quote\n\n^quote\n\n> # Quoted heading ^quoted-heading\n>\n> - Quoted item ^quoted-item\n> > - Nested quoted item ^nested-quoted-item\n\n| Column |\n| --- |\n| Value |\n\n^table\n\n> [!note]\n> Callout\n\n^callout\n\n> [!warning]\n> # Callout heading ^callout-heading\n> - [?] Callout task ^callout-task\n")
	scan := scanObsidianSource(source)
	for _, blockID := range scan.BlockIDs {
		doc.BlockIDs[blockID] = ast.NewNodeID()
	}
	analysisTree, _, _, _ := parseStdMd(source)
	buildObsidianHeadingIndex(doc, analysisTree)
	headingIDs := map[string]string{}
	for _, heading := range doc.Headings {
		headingIDs[heading.Text] = heading.ID
	}
	for text, blockID := range map[string]string{
		"Heading":         "heading",
		"Quoted heading":  "quoted-heading",
		"Callout heading": "callout-heading",
	} {
		if headingIDs[text] != doc.BlockIDs[blockID] {
			t.Fatalf("heading [%s] did not use block ID [%s]: %#v", text, blockID, doc.Headings)
		}
	}
	transformed, stats := transformObsidianMarkdown(nil, doc, source)
	tree, err := parseObsidianMd(transformed, nil, doc, stats)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{
		doc.BlockIDs["heading"]:            true,
		doc.BlockIDs["item"]:               true,
		doc.BlockIDs["task"]:               true,
		doc.BlockIDs["quote"]:              true,
		doc.BlockIDs["quoted-heading"]:     true,
		doc.BlockIDs["quoted-item"]:        true,
		doc.BlockIDs["nested-quoted-item"]: true,
		doc.BlockIDs["table"]:              true,
		doc.BlockIDs["callout"]:            true,
		doc.BlockIDs["callout-heading"]:    true,
		doc.BlockIDs["callout-task"]:       true,
	}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && want[node.ID] {
			delete(want, node.ID)
		}
		return ast.WalkContinue
	})
	if len(want) != 0 {
		t.Fatalf("structured block IDs were not assigned: %#v\n%s", want, transformed)
	}
}

func TestParseObsidianCalloutAndCustomTaskMarker(t *testing.T) {
	doc := newObsidianTestDoc("Current")
	doc.TargetPath = "/" + doc.ID + ".sy"
	doc.HPath = "/Current"
	stats := &obsidianTransformStats{ReservedIDs: map[string]bool{}}
	source := []byte("> [!note]\n> Callout content\n\n- [?] To verify\n- [/] In progress\n")

	tree, err := parseObsidianMd(source, nil, doc, stats)
	if err != nil {
		t.Fatal(err)
	}

	var callout *ast.Node
	markers := map[byte]bool{}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if node.Type == ast.NodeCallout {
			callout = node
		}
		if node.Type == ast.NodeTaskListItemMarker {
			markers[node.TaskListItemMarker] = true
		}
		return ast.WalkContinue
	})

	if callout == nil {
		t.Fatal("callout was not parsed as a callout node")
	}
	if callout.CalloutType != ast.CalloutTypeNote || callout.CalloutIcon == "" || callout.CalloutTitle == "" {
		t.Fatalf("unexpected callout metadata: %#v", callout)
	}
	if !markers['?'] || !markers['/'] {
		t.Fatalf("custom task markers were not preserved: %#v", markers)
	}
}

func TestStartObsidianVaultAnalysisReplacesPreImportTask(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, ".obsidian"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Note.md"), []byte("content\n"), 0644); err != nil {
		t.Fatal(err)
	}

	oldContext, oldCancel := context.WithCancel(context.Background())
	oldTask := &obsidianTask{TaskID: ast.NewNodeID(), State: ObsidianTaskStateReady, Context: &obsidianVaultContext{}, Cancel: oldCancel}
	obsidianTasksMu.Lock()
	previousTasks, previousActive := obsidianTasks, obsidianActive
	obsidianTasks = map[string]*obsidianTask{oldTask.TaskID: oldTask}
	obsidianActive = oldTask.TaskID
	obsidianTasksMu.Unlock()
	t.Cleanup(func() {
		obsidianTasksMu.Lock()
		for _, task := range obsidianTasks {
			if task.Cancel != nil {
				task.Cancel()
			}
		}
		obsidianTasks, obsidianActive = previousTasks, previousActive
		obsidianTasksMu.Unlock()
	})

	started, err := StartObsidianVaultAnalysis(root)
	if err != nil {
		t.Fatal(err)
	}
	if started.TaskID == oldTask.TaskID {
		t.Fatal("the stale pre-import task was not replaced")
	}
	select {
	case <-oldContext.Done():
	default:
		t.Fatal("the stale pre-import task was not cancelled")
	}
	if oldTask.State != ObsidianTaskStateCancelled {
		t.Fatalf("unexpected stale task state: %s", oldTask.State)
	}
	if oldTask.Context != nil {
		t.Fatal("the stale task retained its Vault analysis context")
	}
}

func newObsidianTestDoc(relPath string) *obsidianDocPlan {
	return &obsidianDocPlan{
		RelPath: relPath, Title: strings.TrimPrefix(relPath, pathDirForTest(relPath)), ID: ast.NewNodeID(),
		HeadingByText: map[string][]string{}, HeadingByChain: map[string][]string{}, BlockIDs: map[string]string{},
		DuplicateBlocks: map[string]bool{},
	}
}

func pathDirForTest(relPath string) string {
	index := strings.LastIndex(relPath, "/")
	if index < 0 {
		return ""
	}
	return relPath[:index+1]
}
