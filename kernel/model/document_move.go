// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// preflightDocumentMoveSnapshots 检查整棵子树，未知格式、认证失败和目标冲突都先于首次改动。
func preflightDocumentMoveSnapshots(fromBox, fromPath, toBox, toPath string,
	visit func(before *parse.Tree, destination string)) ([]*treenode.BlockTree, error) {
	if err := filesys.CheckDocumentAddressing(toBox); err != nil {
		return nil, err
	}
	if toPath != "/" {
		if _, err := filesys.ReadDocumentMetadataTree(toBox, toPath); err != nil {
			return nil, err
		}
	}
	paths, err := duplicateDocTreePaths(fromBox, fromPath)
	if err != nil {
		return nil, err
	}
	_, err = filesys.DocumentAddressingMode(toBox)
	if err != nil {
		return nil, err
	}
	toFolder := strings.TrimSuffix(toPath, ".sy")
	destinationFolder := filepath.Join(util.DataDir, toBox, toFolder, util.GetTreeID(fromPath))
	if fromBox != toBox || path.Dir(fromPath) != toFolder {
		if _, err := os.Lstat(destinationFolder); !os.IsNotExist(err) {
			if err != nil {
				return nil, err
			}
			return nil, fmt.Errorf("document move destination directory already exists [%s]", util.GetTreeID(fromPath))
		}
	}
	var documents []*treenode.BlockTree
	err = filesys.WalkTreeSnapshots(fromBox, paths, func(tree *parse.Tree) error {
		sourcePath := tree.Path
		if err := treenode.CheckSpec(tree); err != nil {
			return documentAddressingError("targetModeUnsupported", err)
		}
		relative := strings.TrimPrefix(sourcePath, path.Dir(fromPath)+"/")
		if path.Dir(fromPath) == "/" {
			relative = strings.TrimPrefix(sourcePath, "/")
		}
		destination := path.Join(toFolder, relative)
		if fromBox != toBox || sourcePath != destination {
			if _, err := os.Lstat(filepath.Join(util.DataDir, toBox, destination)); !os.IsNotExist(err) {
				if err != nil {
					return err
				}
				return fmt.Errorf("document move destination already exists [%s]", tree.ID)
			}
		}
		documents = append(documents,
			&treenode.BlockTree{BoxID: fromBox, ID: tree.ID, RootID: tree.ID, Path: sourcePath, Type: "d"},
			&treenode.BlockTree{BoxID: toBox, ID: tree.ID, RootID: tree.ID, Path: destination, Type: "d"})
		if visit != nil {
			visit(tree, destination)
		}
		return nil
	})
	return documents, err
}
