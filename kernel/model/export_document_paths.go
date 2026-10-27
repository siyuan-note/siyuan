// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"path"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/text/unicode/norm"
)

type exportDocumentIdentity struct{ box, id string }
type exportDocumentLocation struct {
	identity exportDocumentIdentity
	parent   exportDocumentIdentity
	title    string
}
type exportDocumentPaths map[exportDocumentIdentity]string

func (paths exportDocumentPaths) get(box, id string) string {
	return paths[exportDocumentIdentity{box, id}]
}

// exportDocumentFileName 把单个标题转换为单个文件名；不解释斜杠、点段或百分号编码。
func exportDocumentFileName(title, id string) string {
	name := strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || strings.ContainsRune(`/\:*?"<>|`, r) {
			return '_'
		}
		return r
	}, title)
	name = strings.TrimRight(name, ". ")
	for len(name) > 120 {
		_, size := utf8.DecodeLastRuneInString(name)
		name = name[:len(name)-size]
	}
	name = strings.TrimRight(name, ". ")
	if name == "" {
		return id
	}
	stem := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
	if stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" ||
		(strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) &&
			strings.Contains("123456789¹²³", strings.TrimPrefix(strings.TrimPrefix(stem, "COM"), "LPT")) &&
			utf8.RuneCountInString(stem) == 4 {
		name = "_" + name
	}
	return name
}

func exportPathComparison(name string) string {
	return strings.Map(func(r rune) rune {
		minimum := r
		for folded := unicode.SimpleFold(r); folded != r; folded = unicode.SimpleFold(folded) {
			if folded < minimum {
				minimum = folded
			}
		}
		return minimum
	}, norm.NFC.String(name))
}

// allocateExportDocumentPaths 先分配完整映射，文件与目录在同一命名空间预留，结果不依赖遍历顺序或正文哈希。
func allocateExportDocumentPaths(locations []exportDocumentLocation, boxPaths map[string]string, ext string) (exportDocumentPaths, error) {
	if !strings.HasPrefix(ext, ".") || strings.ContainsAny(ext, `/\`) {
		return nil, errors.New("invalid export extension")
	}
	children := map[exportDocumentIdentity][]exportDocumentLocation{}
	for _, location := range locations {
		children[location.parent] = append(children[location.parent], location)
	}
	ret := exportDocumentPaths{}
	directories := map[exportDocumentIdentity]string{}
	// 多本导出按既有外层目录隔离；跨本引用未指定目录时仍共享根命名空间。
	usedByDirectory := map[string]map[string]bool{}
	var allocate func(exportDocumentIdentity, string) error
	allocate = func(parent exportDocumentIdentity, directory string) error {
		nodes := children[parent]
		sort.Slice(nodes, func(i, j int) bool {
			return nodes[i].identity.box+nodes[i].identity.id < nodes[j].identity.box+nodes[j].identity.id
		})
		used := usedByDirectory[exportPathComparison(directory)]
		if used == nil {
			used = map[string]bool{"assets": true}
			// 以同一种比较方式保留资源目录。
			used[exportPathComparison("assets")] = true
			usedByDirectory[exportPathComparison(directory)] = used
		}
		for _, node := range nodes {
			name := exportDocumentFileName(node.title, node.identity.id)
			candidate := name
			for suffix := 0; used[exportPathComparison(candidate)] || used[exportPathComparison(candidate+ext)]; suffix++ {
				candidate = name + "-" + node.identity.id
				if suffix > 0 {
					candidate += fmt.Sprintf("-%d", suffix)
				}
			}
			used[exportPathComparison(candidate)], used[exportPathComparison(candidate+ext)] = true, true
			directories[node.identity] = path.Join(directory, candidate)
			ret[node.identity] = directories[node.identity] + ext
		}
		for _, node := range nodes {
			if err := allocate(node.identity, directories[node.identity]); err != nil {
				return err
			}
		}
		return nil
	}
	boxes := map[string]bool{}
	for _, node := range locations {
		boxes[node.identity.box] = true
	}
	ids := make([]string, 0, len(boxes))
	for box := range boxes {
		ids = append(ids, box)
	}
	sort.Strings(ids)
	for _, box := range ids {
		directory := "/"
		if prefix := boxPaths[box]; prefix != "" {
			directory += exportDocumentFileName(prefix, box)
		}
		if err := allocate(exportDocumentIdentity{box: box}, directory); err != nil {
			return nil, err
		}
	}
	if len(ret) != len(locations) {
		return nil, errors.New("export document hierarchy is incomplete")
	}
	return ret, nil
}

func prepareExportDocumentPaths(docPaths []string, boxPaths map[string]string, ext string) (exportDocumentPaths, error) {
	nodes := map[exportDocumentIdentity]exportDocumentLocation{}
	for _, docPath := range docPaths {
		id := util.GetTreeID(docPath)
		tree, err := LoadTreeByBlockID(id)
		if err != nil {
			return nil, err
		}
		ids := strings.Split(strings.Trim(strings.TrimSuffix(tree.Path, ".sy"), "/"), "/")
		if len(docPaths) == 1 && len(boxPaths) == 0 {
			nodes[exportDocumentIdentity{tree.Box, id}] = exportDocumentLocation{
				identity: exportDocumentIdentity{tree.Box, id}, parent: exportDocumentIdentity{box: tree.Box},
				title: treenode.ReadDocumentTitle(tree.Root).Text}
			continue
		}
		parent := exportDocumentIdentity{box: tree.Box}
		for i, ancestorID := range ids {
			if !ast.IsNodeIDPattern(ancestorID) {
				return nil, errors.New("invalid export document data path")
			}
			identity := exportDocumentIdentity{tree.Box, ancestorID}
			if _, exists := nodes[identity]; !exists {
				source, readErr := filesys.ReadDocumentMetadataTree(tree.Box, "/"+strings.Join(ids[:i+1], "/")+".sy")
				if readErr != nil {
					return nil, readErr
				}
				nodes[identity] = exportDocumentLocation{identity: identity, parent: parent, title: treenode.ReadDocumentTitle(source.Root).Text}
			}
			parent = identity
		}
	}
	locations := make([]exportDocumentLocation, 0, len(nodes))
	for _, node := range nodes {
		locations = append(locations, node)
	}
	return allocateExportDocumentPaths(locations, boxPaths, ext)
}
