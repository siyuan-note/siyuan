// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	stdhtml "html"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	docVersionCurrent  = "current"
	docVersionHistory  = "history"
	docVersionSnapshot = "snapshot"

	docDiffMaxLCSCells      = 2_000_000
	docDiffMaxTotalLCSCells = 8_000_000
	docDiffMaxBlocks        = 10_000
)

type DocVersionRef struct {
	Type     string `json:"type"`
	ID       string `json:"id"`
	Path     string `json:"path"`
	Snapshot string `json:"snapshot"`
}

type DocVersionDiffResult struct {
	Left          *DocVersionDiffContent  `json:"left"`
	Right         *DocVersionDiffContent  `json:"right"`
	Differences   []*DocVersionDifference `json:"differences"`
	Large         bool                    `json:"large"`
	Fallback      bool                    `json:"fallback"`
	Message       string                  `json:"message"`
	TitleModified bool                    `json:"titleModified"`
}

type DocVersionDiffContent struct {
	ID      string `json:"id"`
	RootID  string `json:"rootID"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

type DocVersionDifference struct {
	ID       string   `json:"id"`
	Statuses []string `json:"statuses"`
}

type loadedDocVersion struct {
	tree     *parse.Tree
	title    string
	rootID   string
	raw      []byte
	parseErr error
	large    bool
	boxID    string
	history  string
	av       map[string]string
}

type docDiffBlock struct {
	node      *ast.Node
	parentID  string
	signature string
}

type docTextSegment struct {
	node       *ast.Node
	start      int
	end        int
	storedRuns []string
	signature  string
}

type docDiffLCSBudget struct {
	remaining int
}

// ResolveDocVersionBoxID 返回文档版本引用中明确记录的加密笔记本 ID。
func ResolveDocVersionBoxID(ref *DocVersionRef) (string, error) {
	if ref == nil {
		return "", errors.New("document version is required")
	}
	switch ref.Type {
	case docVersionCurrent:
		if !ast.IsNodeIDPattern(ref.ID) {
			return "", errors.New("current document ID is invalid")
		}
		blockTree := treenode.GetBlockTree(ref.ID)
		if blockTree == nil {
			return "", ErrTreeNotFound
		}
		if IsEncryptedBox(blockTree.BoxID) {
			return blockTree.BoxID, nil
		}
		return "", nil
	case docVersionHistory:
		absPath, err := validateHistoryPath(ref.Path)
		if err != nil {
			return "", err
		}
		boxID := ExtractBoxIDFromHistoryPath(absPath)
		if IsEncryptedBox(boxID) {
			return boxID, nil
		}
		return "", nil
	case docVersionSnapshot:
		return ResolveRepoFileBoxID(ref.ID)
	default:
		return "", fmt.Errorf("unsupported document version type [%s]", ref.Type)
	}
}

// DiffDocVersions 比较同一文档的两个版本，并返回带临时差异标记的只读块 DOM。
func DiffDocVersions(leftRef, rightRef *DocVersionRef) (ret *DocVersionDiffResult, err error) {
	if (nil != leftRef && docVersionCurrent == leftRef.Type) || (nil != rightRef && docVersionCurrent == rightRef.Type) {
		FlushTxQueue()
	}
	left, err := loadDocVersion(leftRef)
	if err != nil {
		return nil, err
	}
	right, err := loadDocVersion(rightRef)
	if err != nil {
		return nil, err
	}
	if "" != left.rootID && "" != right.rootID && left.rootID != right.rootID {
		return nil, errors.New("document versions do not belong to the same document")
	}

	ret = &DocVersionDiffResult{
		Differences:   []*DocVersionDifference{},
		Large:         left.large || right.large,
		TitleModified: left.title != right.title,
	}
	if nil == left.tree || nil == right.tree {
		ret.Fallback = true
		ret.Message = docVersionFallbackMessage(left, right)
		ret.TitleModified = false
		ret.Left = renderFallbackDocVersion(left)
		ret.Right = renderFallbackDocVersion(right)
		return
	}
	if ret.TitleModified {
		ret.Differences = append(ret.Differences, &DocVersionDifference{
			ID:       left.tree.Root.ID,
			Statuses: []string{"modified"},
		})
	}
	if ret.Large {
		ret.Left = renderLargeDocVersion(left)
		ret.Right = renderLargeDocVersion(right)
		return
	}
	left.av, err = loadDocVersionAttributeViewSignatures(leftRef, left)
	if err != nil {
		return nil, err
	}
	right.av, err = loadDocVersionAttributeViewSignatures(rightRef, right)
	if err != nil {
		return nil, err
	}

	leftBlocks, leftChildren, leftOrder := collectDocDiffBlocks(left.tree, left.av)
	rightBlocks, rightChildren, rightOrder := collectDocDiffBlocks(right.tree, right.av)
	if len(leftBlocks) > docDiffMaxBlocks || len(rightBlocks) > docDiffMaxBlocks {
		ret.Large = true
		ret.Left = renderLargeDocVersion(left)
		ret.Right = renderLargeDocVersion(right)
		return
	}

	lcsBudget := &docDiffLCSBudget{remaining: docDiffMaxTotalLCSCells}
	moved := detectMovedDocBlocksWithBudget(leftBlocks, rightBlocks, leftChildren, rightChildren, lcsBudget)
	ids := mergeDocDiffBlockOrder(leftOrder, rightOrder)

	for _, id := range ids {
		leftBlock, leftOK := leftBlocks[id]
		rightBlock, rightOK := rightBlocks[id]
		var statuses []string
		switch {
		case leftOK && !rightOK:
			statuses = append(statuses, "left-only")
			setDocDiffBlockAttrs(leftBlock.node, []string{"only"})
		case !leftOK && rightOK:
			statuses = append(statuses, "right-only")
			setDocDiffBlockAttrs(rightBlock.node, []string{"only"})
		default:
			modified := leftBlock.signature != rightBlock.signature
			if modified {
				statuses = append(statuses, "modified")
			}
			if moved[id] {
				statuses = append(statuses, "moved")
			}
			if 0 < len(statuses) {
				setDocDiffBlockAttrs(leftBlock.node, statuses)
				setDocDiffBlockAttrs(rightBlock.node, statuses)
			}
			if modified {
				markDocInlineDiffWithBudget(leftBlock.node, rightBlock.node, lcsBudget)
			}
		}
		if 0 < len(statuses) {
			ret.Differences = append(ret.Differences, &DocVersionDifference{ID: id, Statuses: statuses})
		}
	}

	ret.Left = renderDocVersion(left)
	ret.Right = renderDocVersion(right)
	return
}

func loadDocVersion(ref *DocVersionRef) (ret *loadedDocVersion, err error) {
	if nil == ref {
		return nil, errors.New("document version is required")
	}
	switch ref.Type {
	case docVersionCurrent:
		if !ast.IsNodeIDPattern(ref.ID) {
			return nil, errors.New("current document ID is invalid")
		}
		ret, err = loadCurrentDocVersion(ref.ID)
	case docVersionHistory:
		ret, err = loadHistoryDocVersion(ref.Path)
	case docVersionSnapshot:
		ret, err = loadSnapshotDocVersion(ref.ID)
	default:
		return nil, fmt.Errorf("unsupported document version type [%s]", ref.Type)
	}
	if err != nil {
		return nil, err
	}
	if nil == ret || (nil == ret.tree && 0 == len(ret.raw)) || (nil != ret.tree && nil == ret.tree.Root) {
		return nil, errors.New("document version is empty")
	}
	if nil != ret.tree && "" == ret.rootID {
		ret.rootID = ret.tree.Root.ID
	}
	if nil != ret.tree && "" == ret.title {
		ret.title = ret.tree.Root.IALAttr("title")
	}
	if "" == ret.title {
		ret.title = ret.rootID
	}
	return
}

func loadCurrentDocVersion(id string) (ret *loadedDocVersion, err error) {
	blockTree := treenode.GetBlockTree(id)
	if nil == blockTree {
		return nil, ErrTreeNotFound
	}
	data, err := readCurrentDocVersionData(blockTree)
	if err != nil {
		return nil, err
	}
	ret = &loadedDocVersion{
		title:  blockTree.RootID,
		rootID: blockTree.RootID,
		raw:    data,
		large:  1024*1024 <= len(data),
		boxID:  blockTree.BoxID,
	}
	ret.tree, ret.parseErr = parseDocVersionTree(data, blockTree.RootID)
	if nil != ret.parseErr {
		return ret, nil
	}
	ret.title = ret.tree.Root.IALAttr("title")
	ret.rootID = ret.tree.Root.ID
	return
}

func readCurrentDocVersionData(blockTree *treenode.BlockTree) (ret []byte, err error) {
	relPath, err := filesys.ValidateBoxRelativePath(blockTree.BoxID, blockTree.Path)
	if err != nil {
		return nil, err
	}
	encrypted := IsEncryptedBox(blockTree.BoxID)
	if encrypted {
		HoldBoxReadLock(blockTree.BoxID)
		defer ReleaseBoxReadLock(blockTree.BoxID)
	}
	absPath := filepath.Join(util.DataDir, blockTree.BoxID, filepath.FromSlash(relPath))
	ret, err = filelock.ReadFile(absPath)
	if err != nil || !encrypted {
		return
	}
	dek, err := GetDEKIfUnlocked(blockTree.BoxID)
	if err != nil {
		return nil, errors.New(Conf.Language(314))
	}
	ret, err = DecryptFile(blockTree.BoxID, relPath, dek, ret)
	return
}

func loadHistoryDocVersion(historyPath string) (ret *loadedDocVersion, err error) {
	absPath, err := validateHistoryPath(historyPath)
	if err != nil {
		return nil, err
	}
	if !strings.HasSuffix(strings.ToLower(absPath), ".sy") {
		return nil, errors.New("history version is not a document")
	}
	relPath, err := filepath.Rel(util.HistoryDir, absPath)
	if err != nil {
		return nil, err
	}
	parts := strings.SplitN(filepath.ToSlash(relPath), "/", 3)
	data, err := filelock.ReadFile(absPath)
	if err != nil {
		return nil, err
	}
	ciphertext := util.IsCiphertext(data)
	if ciphertext {
		if len(parts) < 3 || !ast.IsNodeIDPattern(parts[1]) || !IsEncryptedBox(parts[1]) {
			return nil, errors.New("encrypted document history is missing valid notebook context")
		}
		HoldBoxReadLock(parts[1])
		defer ReleaseBoxReadLock(parts[1])
		dek, dekErr := GetDEKIfUnlocked(parts[1])
		if dekErr != nil {
			return nil, errors.New(Conf.Language(314))
		}
		data, err = DecryptFile(parts[1], parts[2], dek, data)
		if err != nil {
			return nil, err
		}
	} else if len(parts) >= 2 && IsEncryptedBox(parts[1]) {
		return nil, fmt.Errorf("encrypted notebook document history is plaintext [%s]", parts[1])
	}

	rootID := strings.TrimSuffix(filepath.Base(absPath), filepath.Ext(absPath))
	tree, err := parseDocVersionTree(data, rootID)
	historyRoot := filepath.Join(util.HistoryDir, parts[0])
	boxID := ""
	if len(parts) >= 2 && ast.IsNodeIDPattern(parts[1]) {
		boxID = parts[1]
	}
	if err != nil {
		return &loadedDocVersion{
			title:    rootID,
			rootID:   rootID,
			raw:      data,
			parseErr: err,
			large:    1024*1024 <= len(data),
			boxID:    boxID,
			history:  historyRoot,
		}, nil
	}
	return &loadedDocVersion{
		tree:    tree,
		title:   tree.Root.IALAttr("title"),
		rootID:  tree.Root.ID,
		raw:     data,
		large:   1024*1024 <= len(data),
		boxID:   boxID,
		history: historyRoot,
	}, nil
}

func loadSnapshotDocVersion(fileID string) (ret *loadedDocVersion, err error) {
	if "" == fileID {
		return nil, errors.New("snapshot file ID is required")
	}
	if 1 > len(Conf.Repo.Key) {
		return nil, errors.New(Conf.Language(26))
	}
	repo, err := newRepository()
	if err != nil {
		return nil, err
	}
	file, err := repo.GetFile(fileID)
	if err != nil {
		return nil, err
	}
	if !strings.HasSuffix(strings.ToLower(file.Path), ".sy") {
		return nil, errors.New("snapshot version is not a document")
	}
	repoPath := strings.TrimPrefix(file.Path, "/")
	pathParts := strings.SplitN(repoPath, "/", 2)
	data, err := repo.OpenFile(file)
	if err != nil {
		return nil, err
	}
	ciphertext := util.IsCiphertext(data)
	if ciphertext {
		if len(pathParts) < 2 || !ast.IsNodeIDPattern(pathParts[0]) || !IsEncryptedBox(pathParts[0]) {
			return nil, errors.New("encrypted snapshot document is missing valid notebook context")
		}
		HoldBoxReadLock(pathParts[0])
		defer ReleaseBoxReadLock(pathParts[0])
		dek, unlockErr := GetDEKIfUnlocked(pathParts[0])
		if unlockErr != nil {
			return nil, errors.New(Conf.Language(314))
		}
		data, err = DecryptFile(pathParts[0], pathParts[1], dek, data)
		if err != nil {
			return nil, err
		}
	} else if len(pathParts) > 0 && IsEncryptedBox(pathParts[0]) {
		return nil, fmt.Errorf("encrypted notebook snapshot document is plaintext [%s]", pathParts[0])
	}
	rootID := strings.TrimSuffix(filepath.Base(file.Path), filepath.Ext(file.Path))
	tree, err := parseDocVersionTree(data, rootID)
	boxID := ""
	if 0 < len(pathParts) && ast.IsNodeIDPattern(pathParts[0]) {
		boxID = pathParts[0]
	}
	if err != nil {
		return &loadedDocVersion{
			title:    rootID,
			rootID:   rootID,
			raw:      data,
			parseErr: err,
			large:    1024*1024 <= len(data),
			boxID:    boxID,
		}, nil
	}
	return &loadedDocVersion{
		tree:   tree,
		title:  tree.Root.IALAttr("title"),
		rootID: tree.Root.ID,
		raw:    data,
		large:  1024*1024 <= len(data),
		boxID:  boxID,
	}, nil
}

func parseDocVersionTree(data []byte, rootID string) (ret *parse.Tree, err error) {
	luteEngine := NewLute()
	ret, _, err = dataparser.ParseJSON(data, luteEngine.ParseOptions)
	if err != nil {
		return
	}
	if err = filesys.NormalizeTreeForRead(ret); err != nil {
		return nil, err
	}
	if ast.IsNodeIDPattern(rootID) && rootID != ret.Root.ID {
		ret.ID = rootID
		ret.Root.ID = rootID
		ret.Root.SetIALAttr("id", rootID)
	}
	return
}

func loadDocVersionAttributeViewSignatures(ref *DocVersionRef, version *loadedDocVersion) (ret map[string]string, err error) {
	ret = map[string]string{}
	ids := map[string]bool{}
	ast.Walk(version.tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeAttributeView == n.Type && "" != n.AttributeViewID {
			ids[n.AttributeViewID] = true
		}
		return ast.WalkContinue
	})
	if 0 == len(ids) {
		return
	}

	var readData func(string) ([]byte, error)
	switch ref.Type {
	case docVersionCurrent:
		readData = func(id string) ([]byte, error) {
			boxID := ""
			if IsEncryptedBox(version.boxID) {
				boxID = version.boxID
			}
			return av.ReadAttributeViewDataInBox(id, boxID)
		}
	case docVersionHistory:
		readData = func(id string) ([]byte, error) {
			boxID := ""
			candidate := filepath.Join(version.history, "storage", "av", id+".json")
			if IsEncryptedBox(version.boxID) {
				boxID = version.boxID
				candidate = filepath.Join(version.history, boxID, "storage", "av", id+".json")
			}
			data, readErr := filelock.ReadFile(candidate)
			if nil != readErr {
				if os.IsNotExist(readErr) {
					return nil, nil
				}
				return nil, readErr
			}
			return decryptHistoricalAttributeView(boxID, id, data)
		}
	case docVersionSnapshot:
		if "" == ref.Snapshot {
			return
		}
		repo, repoErr := newRepository()
		if nil != repoErr {
			return nil, repoErr
		}
		index, indexErr := repo.GetIndex(ref.Snapshot)
		if nil != indexErr {
			return nil, indexErr
		}
		files, filesErr := repo.GetFiles(index)
		if nil != filesErr {
			return nil, filesErr
		}
		readData = func(id string) ([]byte, error) {
			var matchingFiles []*entity.File
			for _, file := range files {
				if strings.HasSuffix(filepath.ToSlash(file.Path), "/storage/av/"+id+".json") {
					matchingFiles = append(matchingFiles, file)
				}
			}
			if len(matchingFiles) == 0 {
				return nil, nil
			}
			if len(matchingFiles) != 1 {
				return nil, fmt.Errorf("attribute view snapshot context is ambiguous [%s]", id)
			}
			file := matchingFiles[0]
			data, readErr := repo.OpenFile(file)
			if nil != readErr {
				return nil, readErr
			}
			return decryptHistoricalAttributeView(avBoxIDFromRepoPath(file.Path), id, data)
		}
	}
	if nil == readData {
		return
	}

	for id := range ids {
		data, readErr := readData(id)
		if nil != readErr {
			return nil, readErr
		}
		if nil == data {
			ret[id] = "missing"
			continue
		}
		ret[id] = docDiffAttributeViewSignature(data)
	}
	return
}

func docDiffAttributeViewSignature(data []byte) string {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); nil == err {
		var extra any
		if err = decoder.Decode(&extra); errors.Is(err, io.EOF) {
			if normalized, marshalErr := json.Marshal(value); nil == marshalErr {
				data = normalized
			}
		}
	}
	hash := sha256.Sum256(data)
	return fmt.Sprintf("%x", hash)
}

func collectDocDiffBlocks(tree *parse.Tree, attributeViews map[string]string) (blocks map[string]*docDiffBlock, children map[string][]string, order []string) {
	blocks = map[string]*docDiffBlock{}
	children = map[string][]string{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeDocument == n.Type || !n.IsBlock() || "" == n.ID {
			return ast.WalkContinue
		}
		parentID := parentDocDiffBlockID(n)
		blocks[n.ID] = &docDiffBlock{
			node:      n,
			parentID:  parentID,
			signature: docDiffBlockSignatureWithAttributeViews(n, attributeViews),
		}
		children[parentID] = append(children[parentID], n.ID)
		order = append(order, n.ID)
		return ast.WalkContinue
	})
	return
}

func parentDocDiffBlockID(node *ast.Node) string {
	for parent := node.Parent; nil != parent; parent = parent.Parent {
		if ast.NodeDocument != parent.Type && parent.IsBlock() && "" != parent.ID {
			return parent.ID
		}
	}
	return ""
}

func docDiffBlockSignature(block *ast.Node) string {
	return docDiffBlockSignatureWithAttributeViews(block, nil)
}

func docDiffBlockSignatureWithAttributeViews(block *ast.Node, attributeViews map[string]string) string {
	var builder strings.Builder
	builder.WriteString(block.Type.String())
	builder.WriteByte('|')
	builder.WriteString(strconv.Itoa(block.HeadingLevel))
	builder.WriteByte('|')
	builder.WriteString(strconv.Itoa(int(block.TaskListItemMarker)))
	builder.WriteByte('|')
	builder.WriteString(block.CustomBlockInfo)
	builder.WriteByte('|')
	builder.Write(block.CodeBlockInfo)
	builder.WriteByte('|')
	builder.WriteString(block.AttributeViewID)
	builder.WriteByte(':')
	builder.WriteString(block.AttributeViewType)
	if signature, ok := attributeViews[block.AttributeViewID]; ok {
		builder.WriteByte(':')
		builder.WriteString(signature)
	}
	builder.WriteByte('|')
	builder.WriteString(block.CalloutType)
	builder.WriteByte(':')
	builder.WriteString(block.CalloutTitle)
	builder.WriteByte(':')
	builder.WriteString(block.CalloutIcon)
	builder.WriteByte(':')
	builder.WriteString(strconv.Itoa(block.CalloutIconType))
	builder.WriteByte('|')
	if nil != block.ListData {
		builder.WriteString(strconv.Itoa(block.ListData.Typ))
		builder.WriteByte(':')
		builder.WriteString(strconv.FormatBool(block.ListData.Tight))
		builder.WriteByte(':')
		builder.WriteString(strconv.Itoa(int(block.ListData.BulletChar)))
		builder.WriteByte(':')
		builder.WriteString(strconv.Itoa(block.ListData.Start))
		builder.WriteByte(':')
		builder.WriteString(strconv.Itoa(int(block.ListData.Delimiter)))
	}
	builder.WriteByte('|')
	for _, align := range block.TableAligns {
		builder.WriteString(strconv.Itoa(align))
		builder.WriteByte(',')
	}

	attrs := make([]string, 0, len(block.KramdownIAL))
	for _, attr := range block.KramdownIAL {
		if 2 > len(attr) || "id" == attr[0] || "updated" == attr[0] || "fold" == attr[0] || "heading-fold" == attr[0] {
			continue
		}
		attrs = append(attrs, attr[0]+"="+attr[1])
	}
	sort.Strings(attrs)
	builder.WriteString(strings.Join(attrs, ";"))

	ast.Walk(block, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if n != block && n.IsBlock() && "" != n.ID {
			return ast.WalkSkipChildren
		}
		builder.WriteByte('|')
		builder.WriteString(n.Type.String())
		builder.WriteByte(':')
		switch n.Type {
		case ast.NodeTextMark:
			builder.WriteString(n.TextMarkType)
			builder.WriteByte(':')
			builder.WriteString(n.TextMarkTextContent)
			builder.WriteByte(':')
			builder.WriteString(n.TextMarkInlineMathContent)
			builder.WriteByte(':')
			builder.WriteString(n.TextMarkAHref)
			builder.WriteByte(':')
			builder.WriteString(n.TextMarkATitle)
			builder.WriteByte(':')
			builder.WriteString(n.TextMarkBlockRefID)
			builder.WriteByte(':')
			builder.WriteString(n.TextMarkFileAnnotationRefID)
			builder.WriteByte(':')
			builder.WriteString(n.TextMarkInlineMemoContent)
		default:
			builder.Write(n.Tokens)
		}
		return ast.WalkContinue
	})
	return builder.String()
}

func detectMovedDocBlocks(left, right map[string]*docDiffBlock, leftChildren, rightChildren map[string][]string) map[string]bool {
	return detectMovedDocBlocksWithBudget(left, right, leftChildren, rightChildren,
		&docDiffLCSBudget{remaining: docDiffMaxTotalLCSCells})
}

func detectMovedDocBlocksWithBudget(left, right map[string]*docDiffBlock, leftChildren, rightChildren map[string][]string,
	budget *docDiffLCSBudget) map[string]bool {
	ret := map[string]bool{}
	for id, leftBlock := range left {
		if rightBlock, ok := right[id]; ok && leftBlock.parentID != rightBlock.parentID {
			ret[id] = true
		}
	}
	for parentID, leftIDs := range leftChildren {
		rightIDs := rightChildren[parentID]
		if 0 == len(rightIDs) {
			continue
		}
		leftShared := filterSharedDocBlockIDs(leftIDs, right)
		rightShared := filterSharedDocBlockIDs(rightIDs, left)
		matches, ok := lcsMatchesWithBudget(leftShared, rightShared, docDiffMaxLCSCells, budget)
		if !ok {
			continue
		}
		stable := map[string]bool{}
		for _, match := range matches {
			stable[leftShared[match[0]]] = true
		}
		for _, id := range leftShared {
			if !stable[id] {
				ret[id] = true
			}
		}
	}
	return ret
}

func mergeDocDiffBlockOrder(left, right []string) (ret []string) {
	ret = append(ret, right...)
	rightSet := map[string]bool{}
	for _, id := range right {
		rightSet[id] = true
	}
	for i, id := range left {
		if rightSet[id] {
			continue
		}
		insertAt := len(ret)
		for _, nextID := range left[i+1:] {
			if !rightSet[nextID] {
				continue
			}
			for index, currentID := range ret {
				if currentID == nextID {
					insertAt = index
					break
				}
			}
			break
		}
		ret = append(ret, "")
		copy(ret[insertAt+1:], ret[insertAt:])
		ret[insertAt] = id
	}
	return
}

func filterSharedDocBlockIDs(ids []string, other map[string]*docDiffBlock) (ret []string) {
	for _, id := range ids {
		if _, ok := other[id]; ok {
			ret = append(ret, id)
		}
	}
	return
}

type docInlineTokenKey struct {
	kind    uint8
	content string
	context string
}

type docAtomicInline struct {
	node  *ast.Node
	index int
}

func markDocInlineDiff(left, right *ast.Node) {
	markDocInlineDiffWithBudget(left, right, &docDiffLCSBudget{remaining: docDiffMaxTotalLCSCells})
}

func markDocInlineDiffWithBudget(left, right *ast.Node, budget *docDiffLCSBudget) {
	leftTokens, leftSegments, leftAtomic := collectDocInlineTokens(left)
	rightTokens, rightSegments, rightAtomic := collectDocInlineTokens(right)
	matches, ok := lcsMatchesWithBudget(leftTokens, rightTokens, docDiffMaxLCSCells, budget)
	if !ok {
		return
	}
	leftChanged := make([]bool, len(leftTokens))
	rightChanged := make([]bool, len(rightTokens))
	for i := range leftChanged {
		leftChanged[i] = true
	}
	for i := range rightChanged {
		rightChanged[i] = true
	}
	for _, match := range matches {
		leftChanged[match[0]] = false
		rightChanged[match[1]] = false
	}
	leftSignatures := docTextSegmentSignatures(leftSegments, len(leftTokens))
	rightSignatures := docTextSegmentSignatures(rightSegments, len(rightTokens))
	for _, match := range matches {
		if 0 == leftTokens[match[0]].kind && leftSignatures[match[0]] != rightSignatures[match[1]] {
			leftChanged[match[0]] = true
			rightChanged[match[1]] = true
		}
	}
	applyDocTextDiff(leftSegments, leftChanged)
	applyDocTextDiff(rightSegments, rightChanged)
	for _, item := range leftAtomic {
		if leftChanged[item.index] {
			item.node.SetIALAttr("data-history-diff", "inline")
		}
	}
	for _, item := range rightAtomic {
		if rightChanged[item.index] {
			item.node.SetIALAttr("data-history-diff", "inline")
		}
	}
}

func collectDocInlineTokens(block *ast.Node) (tokens []docInlineTokenKey, segments []*docTextSegment, atomic []*docAtomicInline) {
	ast.Walk(block, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if n != block && n.IsBlock() && "" != n.ID {
			return ast.WalkSkipChildren
		}
		context := docInlineStructuralContext(n, block)
		var visible []rune
		var storedRuns []string
		switch n.Type {
		case ast.NodeText:
			visible = []rune(string(n.Tokens))
			for _, r := range visible {
				storedRuns = append(storedRuns, string(r))
			}
		case ast.NodeTextMark:
			if "" == n.TextMarkTextContent || n.IsTextMarkType("inline-math") {
				signature := docAtomicInlineSignature(n)
				atomic = append(atomic, &docAtomicInline{node: n, index: len(tokens)})
				tokens = append(tokens, docInlineTokenKey{kind: 1, content: signature, context: context})
				return ast.WalkContinue
			}
			visible, storedRuns = decodeDocTextMarkContent(n)
		default:
			return ast.WalkContinue
		}
		if 0 == len(visible) {
			return ast.WalkContinue
		}
		start := len(tokens)
		for _, r := range visible {
			tokens = append(tokens, docInlineTokenKey{content: string(r), context: context})
		}
		segments = append(segments, &docTextSegment{
			node:       n,
			start:      start,
			end:        len(tokens),
			storedRuns: storedRuns,
			signature:  docTextNodeSignature(n),
		})
		return ast.WalkContinue
	})
	return
}

func docAtomicInlineSignature(node *ast.Node) string {
	return strings.Join([]string{
		node.TextMarkType,
		node.TextMarkInlineMathContent,
		node.TextMarkAHref,
		node.TextMarkATitle,
		node.TextMarkBlockRefID,
		node.TextMarkFileAnnotationRefID,
		node.TextMarkInlineMemoContent,
	}, "\x00")
}

func docInlineStructuralContext(node, block *ast.Node) string {
	var parts []string
	for parent := node.Parent; nil != parent && parent != block; parent = parent.Parent {
		if ast.NodeTableRow != parent.Type && ast.NodeTableCell != parent.Type {
			continue
		}
		index := 0
		for previous := parent.Previous; nil != previous; previous = previous.Previous {
			if previous.Type == parent.Type {
				index++
			}
		}
		parts = append(parts, parent.Type.String()+":"+strconv.Itoa(index))
	}
	for i, j := 0, len(parts)-1; i < j; i, j = i+1, j-1 {
		parts[i], parts[j] = parts[j], parts[i]
	}
	return strings.Join(parts, "/")
}

func docTextSegmentSignatures(segments []*docTextSegment, length int) (ret []string) {
	ret = make([]string, length)
	for _, segment := range segments {
		for i := segment.start; i < segment.end; i++ {
			ret[i] = segment.signature
		}
	}
	return
}

func docTextNodeSignature(node *ast.Node) string {
	if ast.NodeText == node.Type {
		return node.Type.String()
	}
	return strings.Join([]string{
		node.Type.String(),
		node.TextMarkType,
		node.TextMarkAHref,
		node.TextMarkATitle,
		node.TextMarkBlockRefID,
		node.TextMarkFileAnnotationRefID,
		node.TextMarkInlineMemoContent,
	}, "|")
}

func decodeDocTextMarkContent(node *ast.Node) (visible []rune, storedRuns []string) {
	content := node.TextMarkTextContent
	unescape := node.IsTextMarkType("code") || node.IsTextMarkType("tag") || node.IsTextMarkType("strong") ||
		node.IsTextMarkType("em") || node.IsTextMarkType("a")
	if !unescape {
		visible = []rune(content)
		for _, r := range visible {
			storedRuns = append(storedRuns, string(r))
		}
		return
	}

	for 0 < len(content) {
		if '&' == content[0] {
			if semicolon := strings.IndexByte(content, ';'); 0 < semicolon && semicolon < 32 {
				raw := content[:semicolon+1]
				decoded := stdhtml.UnescapeString(raw)
				if decoded != raw {
					decodedRunes := []rune(decoded)
					visible = append(visible, decodedRunes...)
					storedRuns = append(storedRuns, raw)
					for i := 1; i < len(decodedRunes); i++ {
						storedRuns = append(storedRuns, "")
					}
					content = content[semicolon+1:]
					continue
				}
			}
		}
		r := []rune(content)[0]
		raw := string(r)
		visible = append(visible, r)
		storedRuns = append(storedRuns, raw)
		content = content[len(raw):]
	}
	return
}

func applyDocTextDiff(segments []*docTextSegment, changed []bool) {
	for _, segment := range segments {
		local := changed[segment.start:segment.end]
		for start := 0; start < len(segment.storedRuns); {
			end := start + 1
			for end < len(segment.storedRuns) && "" == segment.storedRuns[end] {
				end++
			}
			groupChanged := false
			for i := start; i < end; i++ {
				groupChanged = groupChanged || local[i]
			}
			if groupChanged {
				for i := start; i < end; i++ {
					local[i] = true
				}
			}
			start = end
		}
		hasChanged := false
		for _, value := range local {
			if value {
				hasChanged = true
				break
			}
		}
		if !hasChanged {
			continue
		}

		type textPart struct {
			changed bool
			content string
		}
		var parts []textPart
		for i, value := range local {
			raw := segment.storedRuns[i]
			if 0 == len(parts) || parts[len(parts)-1].changed != value {
				parts = append(parts, textPart{changed: value, content: raw})
			} else {
				parts[len(parts)-1].content += raw
			}
		}
		for _, part := range parts {
			if "" == part.content {
				continue
			}
			replacement := cloneDocTextNode(segment.node)
			if ast.NodeText == replacement.Type {
				if part.changed {
					replacement.Type = ast.NodeTextMark
					replacement.TextMarkTextContent = stdhtml.EscapeString(part.content)
					replacement.Tokens = nil
					replacement.SetIALAttr("data-history-diff", "inline")
				} else {
					replacement.Tokens = []byte(part.content)
				}
			} else {
				replacement.TextMarkTextContent = part.content
				if part.changed {
					replacement.SetIALAttr("data-history-diff", "inline")
				}
			}
			segment.node.InsertBefore(replacement)
		}
		segment.node.Unlink()
	}
}

func cloneDocTextNode(node *ast.Node) *ast.Node {
	ret := *node
	ret.Parent = nil
	ret.Previous = nil
	ret.Next = nil
	ret.FirstChild = nil
	ret.LastChild = nil
	ret.Children = nil
	ret.KramdownIAL = make([][]string, 0, len(node.KramdownIAL))
	for _, attr := range node.KramdownIAL {
		ret.KramdownIAL = append(ret.KramdownIAL, append([]string(nil), attr...))
	}
	ret.Tokens = append([]byte(nil), node.Tokens...)
	return &ret
}

func lcsMatches[T comparable](left, right []T, maxCells int) (matches [][2]int, ok bool) {
	return lcsMatchesWithBudget(left, right, maxCells, &docDiffLCSBudget{remaining: maxCells})
}

func lcsMatchesWithBudget[T comparable](left, right []T, maxCells int,
	budget *docDiffLCSBudget) (matches [][2]int, ok bool) {
	if 0 == len(left) || 0 == len(right) {
		return [][2]int{}, true
	}
	prefix := 0
	for prefix < len(left) && prefix < len(right) && left[prefix] == right[prefix] {
		matches = append(matches, [2]int{prefix, prefix})
		prefix++
	}
	suffix := 0
	for prefix+suffix < len(left) && prefix+suffix < len(right) &&
		left[len(left)-suffix-1] == right[len(right)-suffix-1] {
		suffix++
	}
	leftMiddle := left[prefix : len(left)-suffix]
	rightMiddle := right[prefix : len(right)-suffix]
	if 0 < len(leftMiddle) && 0 < len(rightMiddle) {
		height := len(leftMiddle) + 1
		width := len(rightMiddle) + 1
		if height > maxCells/width || nil == budget || height > budget.remaining/width {
			return nil, false
		}
		cells := height * width
		budget.remaining -= cells
		middleMatches := lcsMatchesTable(leftMiddle, rightMiddle)
		for _, match := range middleMatches {
			matches = append(matches, [2]int{match[0] + prefix, match[1] + prefix})
		}
	}
	for i := suffix; 0 < i; i-- {
		matches = append(matches, [2]int{len(left) - i, len(right) - i})
	}
	return matches, true
}

func lcsMatchesTable[T comparable](left, right []T) (matches [][2]int) {
	if 0 == len(left) || 0 == len(right) {
		return
	}
	width := len(right) + 1
	table := make([]int, (len(left)+1)*width)
	for i := len(left) - 1; 0 <= i; i-- {
		for j := len(right) - 1; 0 <= j; j-- {
			index := i*width + j
			if left[i] == right[j] {
				table[index] = table[(i+1)*width+j+1] + 1
			} else if table[(i+1)*width+j] >= table[i*width+j+1] {
				table[index] = table[(i+1)*width+j]
			} else {
				table[index] = table[i*width+j+1]
			}
		}
	}
	for i, j := 0, 0; i < len(left) && j < len(right); {
		if left[i] == right[j] {
			matches = append(matches, [2]int{i, j})
			i++
			j++
		} else if table[(i+1)*width+j] >= table[i*width+j+1] {
			i++
		} else {
			j++
		}
	}
	return matches
}

func setDocDiffBlockAttrs(node *ast.Node, statuses []string) {
	node.SetIALAttr("data-history-diff", strings.Join(statuses, " "))
}

func prepareDocDiffTree(tree *parse.Tree) {
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			n.RemoveIALAttr("heading-fold")
			n.RemoveIALAttr("fold")
		}
		return ast.WalkContinue
	})
}

func docVersionFallbackMessage(versions ...*loadedDocVersion) string {
	for _, version := range versions {
		if nil != version && nil != version.parseErr {
			return version.parseErr.Error()
		}
	}
	return ""
}

func renderFallbackDocVersion(version *loadedDocVersion) *DocVersionDiffContent {
	return &DocVersionDiffContent{
		ID:      version.rootID,
		RootID:  version.rootID,
		Title:   version.title,
		Content: string(version.raw),
	}
}

func renderDocVersion(version *loadedDocVersion) *DocVersionDiffContent {
	prepareDocDiffTree(version.tree)
	luteEngine := NewLute()
	luteEngine.RenderOptions.ProtyleContenteditable = false
	return &DocVersionDiffContent{
		ID:      version.tree.Root.ID,
		RootID:  version.tree.Root.ID,
		Title:   version.title,
		Content: luteEngine.Tree2BlockDOM(version.tree, luteEngine.RenderOptions, luteEngine.ParseOptions),
	}
}

func renderLargeDocVersion(version *loadedDocVersion) *DocVersionDiffContent {
	prepareDocDiffTree(version.tree)
	luteEngine := NewLute()
	luteEngine.RenderOptions.ProtyleContenteditable = false
	formatRenderer := render.NewFormatRenderer(version.tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	return &DocVersionDiffContent{
		ID:      version.tree.Root.ID,
		RootID:  version.tree.Root.ID,
		Title:   version.title,
		Content: string(formatRenderer.Render()),
	}
}
