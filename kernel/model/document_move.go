package model

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// preflightDocumentMove 检查整棵子树，未知格式、认证失败和目标冲突都先于首次改动。
func preflightDocumentMove(fromBox, fromPath, toBox, toPath string) ([]*treenode.BlockTree, error) {
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
	for _, sourcePath := range paths {
		tree, _, err := filesys.ReadTreeSnapshot(fromBox, sourcePath)
		if err != nil {
			return nil, err
		}
		mode, modeErr := filesys.DocumentAddressingMode(toBox)
		if modeErr != nil {
			return nil, modeErr
		}
		if err = treenode.CheckSpecForMode(tree, mode); err != nil {
			return nil, documentAddressingError("targetModeUnsupported", err)
		}
		relative := strings.TrimPrefix(sourcePath, path.Dir(fromPath)+"/")
		if path.Dir(fromPath) == "/" {
			relative = strings.TrimPrefix(sourcePath, "/")
		}
		destination := path.Join(toFolder, relative)
		if fromBox != toBox || sourcePath != destination {
			if _, err := os.Lstat(filepath.Join(util.DataDir, toBox, destination)); !os.IsNotExist(err) {
				if err != nil {
					return nil, err
				}
				return nil, fmt.Errorf("document move destination already exists [%s]", tree.ID)
			}
		}
		documents = append(documents,
			&treenode.BlockTree{BoxID: fromBox, ID: tree.ID, RootID: tree.ID, Path: sourcePath, Type: "d"},
			&treenode.BlockTree{BoxID: toBox, ID: tree.ID, RootID: tree.ID, Path: destination, Type: "d"})
	}
	return documents, nil
}
