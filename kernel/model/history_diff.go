// SiYuan - Refactor your thinking
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
	"errors"
	"fmt"
	stdhtml "html"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	docVersionCurrent  = "current"
	docVersionHistory  = "history"
	docVersionSnapshot = "snapshot"

	docDiffMaxLCSCells = 2_000_000
	docDiffMaxBlocks   = 10_000
)

type DocVersionRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Path string `json:"path"`
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

	leftBlocks, leftChildren, leftOrder := collectDocDiffBlocks(left.tree)
	rightBlocks, rightChildren, rightOrder := collectDocDiffBlocks(right.tree)
	if len(leftBlocks) > docDiffMaxBlocks || len(rightBlocks) > docDiffMaxBlocks {
		ret.Large = true
		ret.Left = renderLargeDocVersion(left)
		ret.Right = renderLargeDocVersion(right)
		return
	}

	moved := detectMovedDocBlocks(leftBlocks, rightBlocks, leftChildren, rightChildren)
	ids := make([]string, 0, len(leftBlocks)+len(rightBlocks))
	seen := map[string]bool{}
	for _, id := range rightOrder {
		ids = append(ids, id)
		seen[id] = true
	}
	for _, id := range leftOrder {
		if !seen[id] {
			ids = append(ids, id)
		}
	}

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
				markDocInlineDiff(leftBlock.node, rightBlock.node)
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
	}
	ret.tree, err = LoadTreeByBlockID(id)
	if nil != err || nil == ret.tree {
		luteEngine := NewLute()
		_, ret.parseErr = dataparser.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
		if nil != ret.parseErr {
			return ret, nil
		}
		if nil == err {
			err = ErrTreeNotFound
		}
		return nil, err
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
	if len(parts) >= 2 && IsEncryptedBox(parts[1]) {
		HoldBoxReadLock(parts[1])
		defer ReleaseBoxReadLock(parts[1])
	}
	data, err := filelock.ReadFile(absPath)
	if err != nil {
		return nil, err
	}
	if len(parts) >= 2 && IsEncryptedBox(parts[1]) {
		dek, dekErr := GetDEKIfUnlocked(parts[1])
		if dekErr != nil {
			return nil, errors.New(Conf.Language(314))
		}
		filePath := ""
		if len(parts) >= 3 {
			filePath = parts[2]
		}
		data, err = DecryptFile(parts[1], filePath, dek, data)
		if err != nil {
			return nil, err
		}
	}

	luteEngine := NewLute()
	tree, err := dataparser.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
	rootID := strings.TrimSuffix(filepath.Base(absPath), filepath.Ext(absPath))
	if err != nil {
		return &loadedDocVersion{
			title:    rootID,
			rootID:   rootID,
			raw:      data,
			parseErr: err,
			large:    1024*1024 <= len(data),
		}, nil
	}
	return &loadedDocVersion{
		tree:   tree,
		title:  tree.Root.IALAttr("title"),
		rootID: tree.Root.ID,
		raw:    data,
		large:  1024*1024 <= len(data),
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
	if 0 < len(pathParts) && IsEncryptedBox(pathParts[0]) {
		HoldBoxReadLock(pathParts[0])
		defer ReleaseBoxReadLock(pathParts[0])
		dek, unlockErr := GetDEKIfUnlocked(pathParts[0])
		if unlockErr != nil {
			return nil, errors.New(Conf.Language(314))
		}
		if 2 > len(pathParts) {
			return nil, errors.New("snapshot document path is invalid")
		}
		data, err = DecryptFile(pathParts[0], pathParts[1], dek, data)
		if err != nil {
			return nil, err
		}
	}
	luteEngine := NewLute()
	tree, err := dataparser.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
	rootID := strings.TrimSuffix(filepath.Base(file.Path), filepath.Ext(file.Path))
	if err != nil {
		return &loadedDocVersion{
			title:    rootID,
			rootID:   rootID,
			raw:      data,
			parseErr: err,
			large:    1024*1024 <= len(data),
		}, nil
	}
	return &loadedDocVersion{
		tree:   tree,
		title:  tree.Root.IALAttr("title"),
		rootID: tree.Root.ID,
		raw:    data,
		large:  1024*1024 <= len(data),
	}, nil
}

func collectDocDiffBlocks(tree *parse.Tree) (blocks map[string]*docDiffBlock, children map[string][]string, order []string) {
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
			signature: docDiffBlockSignature(n),
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
		if n != block && n.IsBlock() {
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
		matches, ok := lcsMatches(leftShared, rightShared, docDiffMaxLCSCells)
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

func filterSharedDocBlockIDs(ids []string, other map[string]*docDiffBlock) (ret []string) {
	for _, id := range ids {
		if _, ok := other[id]; ok {
			ret = append(ret, id)
		}
	}
	return
}

func markDocInlineDiff(left, right *ast.Node) {
	leftRunes, leftSegments, leftOK := collectDocTextSegments(left)
	rightRunes, rightSegments, rightOK := collectDocTextSegments(right)
	if leftOK && rightOK {
		matches, ok := lcsMatches(leftRunes, rightRunes, docDiffMaxLCSCells)
		if ok {
			leftChanged := make([]bool, len(leftRunes))
			rightChanged := make([]bool, len(rightRunes))
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
			leftSignatures := docTextSegmentSignatures(leftSegments, len(leftRunes))
			rightSignatures := docTextSegmentSignatures(rightSegments, len(rightRunes))
			for _, match := range matches {
				if leftSignatures[match[0]] != rightSignatures[match[1]] {
					leftChanged[match[0]] = true
					rightChanged[match[1]] = true
				}
			}
			applyDocTextDiff(leftSegments, leftChanged)
			applyDocTextDiff(rightSegments, rightChanged)
		}
	}
	markDocAtomicInlineDiff(left, right)
}

type docAtomicInline struct {
	node      *ast.Node
	signature string
}

func markDocAtomicInlineDiff(left, right *ast.Node) {
	leftNodes := collectDocAtomicInlineNodes(left)
	rightNodes := collectDocAtomicInlineNodes(right)
	leftSignatures := make([]string, 0, len(leftNodes))
	rightSignatures := make([]string, 0, len(rightNodes))
	for _, item := range leftNodes {
		leftSignatures = append(leftSignatures, item.signature)
	}
	for _, item := range rightNodes {
		rightSignatures = append(rightSignatures, item.signature)
	}
	matches, ok := lcsMatches(leftSignatures, rightSignatures, docDiffMaxLCSCells)
	if !ok {
		return
	}
	leftMatched := make([]bool, len(leftNodes))
	rightMatched := make([]bool, len(rightNodes))
	for _, match := range matches {
		leftMatched[match[0]] = true
		rightMatched[match[1]] = true
	}
	for i, item := range leftNodes {
		if !leftMatched[i] {
			item.node.SetIALAttr("data-history-diff", "inline")
		}
	}
	for i, item := range rightNodes {
		if !rightMatched[i] {
			item.node.SetIALAttr("data-history-diff", "inline")
		}
	}
}

func collectDocAtomicInlineNodes(block *ast.Node) (ret []*docAtomicInline) {
	ast.Walk(block, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if n != block && n.IsBlock() {
			return ast.WalkSkipChildren
		}
		if ast.NodeTextMark != n.Type || "" != n.TextMarkTextContent {
			return ast.WalkContinue
		}
		ret = append(ret, &docAtomicInline{
			node: n,
			signature: strings.Join([]string{
				n.TextMarkType,
				n.TextMarkInlineMathContent,
				n.TextMarkAHref,
				n.TextMarkATitle,
				n.TextMarkBlockRefID,
				n.TextMarkFileAnnotationRefID,
				n.TextMarkInlineMemoContent,
			}, "\x00"),
		})
		return ast.WalkContinue
	})
	return
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

func collectDocTextSegments(block *ast.Node) (runes []rune, segments []*docTextSegment, ok bool) {
	ok = true
	ast.Walk(block, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if n != block && n.IsBlock() {
			return ast.WalkSkipChildren
		}
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
				return ast.WalkContinue
			}
			visible, storedRuns = decodeDocTextMarkContent(n)
		default:
			return ast.WalkContinue
		}
		if 0 == len(visible) {
			return ast.WalkContinue
		}
		start := len(runes)
		runes = append(runes, visible...)
		segments = append(segments, &docTextSegment{
			node:       n,
			start:      start,
			end:        len(runes),
			storedRuns: storedRuns,
			signature:  docTextNodeSignature(n),
		})
		return ast.WalkContinue
	})
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
	if 0 == len(left) || 0 == len(right) {
		return [][2]int{}, true
	}
	if len(left) > maxCells/len(right) {
		return nil, false
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
	return matches, true
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
