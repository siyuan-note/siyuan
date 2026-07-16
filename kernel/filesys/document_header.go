// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const MaxValidatedDocumentBlockIDs = 100_000

type RepairMask uint8

const (
	RepairParser RepairMask = 1 << iota
	RepairSpec
	RepairAttributes
	RepairBlockIdentities
)

// ValidatedDocument 保存一次读取和解析得到的最终文档对象。
type ValidatedDocument struct {
	Tree       *parse.Tree
	BlockIDs   []string
	RepairMask RepairMask
	Size       int64
}

type documentHeader struct {
	ID         string `json:"ID"`
	Type       string `json:"Type"`
	Properties struct {
		ID string `json:"id"`
	} `json:"Properties"`
}

// ValidateDocumentHeader parses exactly one complete .sy JSON value and binds
// its root identity to the filename chosen by the caller. Keeping this check
// separate from LoadTree is important because legacy loading may repair a
// mismatched root ID in memory, hiding an unsafe raw copy from the caller.
func ValidateDocumentHeader(reader io.Reader, size int64, expectedID string, maxBytes int64) error {
	if size < 2 || size > maxBytes {
		return errors.New("document size is outside the supported range")
	}
	decoder := json.NewDecoder(io.LimitReader(reader, maxBytes+1))
	var header documentHeader
	if err := decoder.Decode(&header); err != nil {
		return fmt.Errorf("malformed JSON: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return fmt.Errorf("malformed trailing JSON: %w", err)
	}
	if header.ID != expectedID || header.Type != "NodeDocument" {
		return fmt.Errorf("root ID or node type does not match %s", expectedID)
	}
	if header.Properties.ID != "" && header.Properties.ID != expectedID {
		return fmt.Errorf("document properties ID does not match %s", expectedID)
	}
	return nil
}

// ValidateDocumentPayload performs the identity check above and then runs the
// same full, side-effect-free dataparser/spec validation used by normal tree
// loading. Header-only decoding is insufficient because malformed Children or
// nested nodes can otherwise be committed before indexing discovers them.
func ValidateDocumentPayload(reader io.Reader, size int64, expectedID string, maxBytes int64) error {
	_, err := ValidateDocument(reader, size, expectedID, maxBytes)
	return err
}

// ValidateDocumentPayloadBlockIDs additionally returns the complete set of
// block IDs from the already-parsed tree. Raw document publishers use this to
// reject cross-document ID collisions without parsing a large payload twice.
func ValidateDocumentPayloadBlockIDs(reader io.Reader, size int64, expectedID string, maxBytes int64) ([]string, error) {
	document, err := ValidateDocument(reader, size, expectedID, maxBytes)
	if document == nil {
		return nil, err
	}
	return document.BlockIDs, err
}

func ValidateDocument(reader io.Reader, size int64, expectedID string, maxBytes int64) (*ValidatedDocument, error) {
	if size < 2 || size > maxBytes {
		return nil, errors.New("document size is outside the supported range")
	}
	data, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read document: %w", err)
	}
	if int64(len(data)) != size {
		return nil, errors.New("document size changed while validating")
	}
	return ValidateDocumentBytes(data, expectedID, maxBytes)
}

func ValidateDocumentBytes(data []byte, expectedID string, maxBytes int64) (*ValidatedDocument, error) {
	size := int64(len(data))
	if size < 2 || size > maxBytes {
		return nil, errors.New("document size is outside the supported range")
	}
	if err := ValidateDocumentHeader(bytes.NewReader(data), size, expectedID, maxBytes); err != nil {
		return nil, err
	}
	luteEngine := util.NewLute()
	strictTree, err := dataparser.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
	if err != nil {
		return nil, fmt.Errorf("strictly parse document: %w", err)
	}
	if strictTree == nil || strictTree.Root == nil || strictTree.Root.ID != expectedID || strictTree.Root.Type != ast.NodeDocument {
		return nil, fmt.Errorf("parsed document root does not match %s", expectedID)
	}
	blockIDs, err := collectStrictDocumentBlockIDs(strictTree.Root)
	if err != nil {
		return nil, err
	}

	// Normal loading is allowed to repair legacy documents, but raw plugin
	// publication is not: generated/fixed identities would not exist in the
	// staged bytes and could differ again when the later index request parses
	// the file. Require the accepted raw AST and the normal parser's final AST to
	// contain exactly the same block identities and reject every other repair.
	parsedTree, needFix, err := parseJSON2TreeWithFixState("", "/"+expectedID+".sy", data, luteEngine)
	if err != nil {
		return nil, err
	}
	repairMask := RepairMask(0)
	if needFix {
		repairMask |= RepairParser
	}
	if treenode.UpgradeSpec(parsedTree) {
		repairMask |= RepairSpec
	}
	if escapeAttributeValues(parsedTree) {
		repairMask |= RepairAttributes
	}
	parsedBlockIDs, err := collectParsedDocumentBlockIDs(parsedTree.Root)
	if err != nil {
		return nil, err
	}
	if !slices.Equal(blockIDs, parsedBlockIDs) {
		repairMask |= RepairBlockIdentities
	}
	document := &ValidatedDocument{Tree: parsedTree, BlockIDs: blockIDs, RepairMask: repairMask, Size: size}
	if repairMask != 0 {
		return document, errors.New("document requires parser repair or generated block identities")
	}
	return document, nil
}

func collectStrictDocumentBlockIDs(root *ast.Node) ([]string, error) {
	seen := map[string]struct{}{}
	blockIDs := make([]string, 0, 64)
	var validationErr error
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || validationErr != nil {
			return ast.WalkContinue
		}
		if node.Type == -1 {
			validationErr = errors.New("document contains an unknown node type")
			return ast.WalkStop
		}
		if node.ID != "" {
			if !ast.IsNodeIDPattern(node.ID) {
				validationErr = fmt.Errorf("invalid block ID %q", node.ID)
				return ast.WalkStop
			}
			if _, duplicate := seen[node.ID]; duplicate {
				validationErr = fmt.Errorf("duplicate block ID %s", node.ID)
				return ast.WalkStop
			}
			seen[node.ID] = struct{}{}
		}
		if !node.IsBlock() {
			return ast.WalkContinue
		}
		if node.ID == "" {
			validationErr = fmt.Errorf("block %s is missing an ID", node.Type.String())
			return ast.WalkStop
		}
		if node.IALAttr("id") != node.ID {
			validationErr = fmt.Errorf("block %s properties ID does not match %s", node.Type.String(), node.ID)
			return ast.WalkStop
		}
		blockIDs = append(blockIDs, node.ID)
		if len(blockIDs) > MaxValidatedDocumentBlockIDs {
			validationErr = fmt.Errorf("document contains more than %d block IDs", MaxValidatedDocumentBlockIDs)
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	if validationErr != nil {
		return nil, validationErr
	}
	return blockIDs, nil
}

func collectParsedDocumentBlockIDs(root *ast.Node) ([]string, error) {
	if root == nil {
		return nil, errors.New("parsed document has no root")
	}
	blockIDs := make([]string, 0, 64)
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.IsBlock() && node.ID != "" {
			blockIDs = append(blockIDs, node.ID)
		}
		return ast.WalkContinue
	})
	return blockIDs, nil
}
