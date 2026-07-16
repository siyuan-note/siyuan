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

package filesys

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	jsoniter "github.com/json-iterator/go"
	"github.com/panjf2000/ants/v2"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func LoadTrees(ids []string) (ret map[string]*parse.Tree) {
	ret = map[string]*parse.Tree{}
	if 1 > len(ids) {
		return ret
	}

	bts := treenode.GetBlockTrees(ids)

	// 全局 blocktree 未命中的 id，遍历已打开的加密笔记本查找
	foundSet := map[string]bool{}
	for id := range bts {
		foundSet[id] = true
	}
	var missing []string
	for _, id := range ids {
		if !foundSet[id] {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
			if len(missing) == 0 {
				break
			}
			encBTs := treenode.GetBlockTreesInBox(missing, encBoxID)
			maps.Copy(bts, encBTs)
			var stillMissing []string
			for _, id := range missing {
				if _, found := encBTs[id]; !found {
					stillMissing = append(stillMissing, id)
				}
			}
			missing = stillMissing
		}
	}

	luteEngine := util.NewLute()
	var boxIDs []string
	var paths []string
	blockIDs := map[string][]string{}
	for _, bt := range bts {
		boxIDs = append(boxIDs, bt.BoxID)
		paths = append(paths, bt.Path)
		if _, ok := blockIDs[bt.RootID]; !ok {
			blockIDs[bt.RootID] = []string{}
		}
		blockIDs[bt.RootID] = append(blockIDs[bt.RootID], bt.ID)
	}

	trees, errs := batchLoadTrees(boxIDs, paths, luteEngine)
	for i := range trees {
		tree := trees[i]
		err := errs[i]
		if err != nil || tree == nil {
			logging.LogErrorf("load tree failed: %s", err)
			continue
		}

		bIDs := blockIDs[tree.Root.ID]
		for _, bID := range bIDs {
			ret[bID] = tree
		}
	}
	return
}

func batchLoadTrees(boxIDs, paths []string, luteEngine *lute.Lute) (ret []*parse.Tree, errs []error) {
	waitGroup := sync.WaitGroup{}
	lock := sync.Mutex{}
	poolSize := min(runtime.NumCPU(), 8)

	p, _ := ants.NewPoolWithFunc(poolSize, func(arg any) {
		defer waitGroup.Done()

		i := arg.(int)
		boxID := boxIDs[i]
		path := paths[i]
		tree, err := LoadTree(boxID, path, luteEngine)
		lock.Lock()
		ret = append(ret, tree)
		errs = append(errs, err)
		lock.Unlock()
	})
	loaded := map[string]bool{}
	for i := range paths {
		if loaded[boxIDs[i]+paths[i]] {
			continue
		}

		loaded[boxIDs[i]+paths[i]] = true

		waitGroup.Add(1)
		p.Invoke(i)
	}
	waitGroup.Wait()
	p.Release()
	return
}

// ValidateBoxRelativePath 校验 box 内相对路径是否安全。
// 拒绝 ..、绝对路径，确保最终路径位于 <DataDir>/<boxID> 内。
// 允许路径以 / 开头（如 /20230101/xxx.sy），会自动标准化再去掉前导斜杠。
// 根路径（"/" 或 ""）合法，返回空字符串。
func ValidateBoxRelativePath(boxID, p string) (string, error) {
	p = filepath.ToSlash(p)
	// 记录原始路径用于 IsSubPath 校验
	origP := p
	// 标准化：去掉前导 /
	p = strings.TrimPrefix(p, "/")
	// 根路径直接放行（box 根目录本身是合法路径）
	if p == "" {
		return p, nil
	}
	if strings.HasPrefix(p, "..") || strings.Contains(p, "/../") || strings.HasSuffix(p, "/..") || p == ".." || p == "." {
		return "", fmt.Errorf("path [%s] must not contain '..'", origP)
	}
	resolved := filepath.Join(util.DataDir, boxID, origP)
	boxRoot := filepath.Join(util.DataDir, boxID)
	if !gulu.File.IsSubPath(boxRoot, resolved) {
		return "", fmt.Errorf("path [%s] escapes box directory", origP)
	}
	return p, nil
}

func LoadTreeWithFix(boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, needFix bool, err error) {
	guard := treenode.LockDocumentIdentityMutation()
	defer guard.Unlock()
	return LoadTreeWithFixIdentityLocked(guard, boxID, p, luteEngine)
}

// LoadTreeWithFixIdentityLocked loads an editor tree while reusing the
// caller's ordinary document-identity transaction. Loading can repair legacy
// JSON or rebuild a missing parent document, so those filesystem and index
// side effects must stay in the same identity domain as the caller's later
// blocktree mutation and publication.
func LoadTreeWithFixIdentityLocked(guard treenode.DocumentIdentityMutationGuard, boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, needFix bool, err error) {
	if err = treenode.ValidateDocumentIdentityMutationGuard(guard); err != nil {
		return nil, false, err
	}
	return loadTreeWithFixIdentityLocked(guard, boxID, p, luteEngine)
}

func loadTreeWithFixIdentityLocked(guard treenode.DocumentIdentityMutationGuard, boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, needFix bool, err error) {
	if _, err = ValidateBoxRelativePath(boxID, p); err != nil {
		logging.LogErrorf("invalid tree path [%s] for box [%s]: %s", p, boxID, err)
		return
	}
	rootID := util.GetTreeID(p)
	if raw, ok := cache.GetTreeDataInBox(rootID, boxID); ok {
		ret, err = loadTreeByData(raw, boxID, p, luteEngine, true, guard)
		return
	}

	filePath := filepath.Join(util.DataDir, boxID, p)
	data, err := filelock.ReadFile(filePath)
	if nil != err {
		logging.LogErrorf("load tree [%s] failed: %s", p, err)
		return
	}

	// 加密笔记本的 .sy 是密文，读盘后解密成明文供后续解析；非加密笔记本原样返回
	if data, err = decryptData(boxID, p, data); nil != err {
		logging.LogErrorf("decrypt tree [%s] failed: %s", p, err)
		return
	}

	data, needFix, err = fixTreeJSONData(boxID, p, data, luteEngine)
	if nil != err {
		return
	}

	ret, err = loadTreeByData(data, boxID, p, luteEngine, true, guard)
	if nil == err {
		cache.SetTreeDataInBox(rootID, boxID, data)
	}
	return
}

func LoadTree(boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	ret, _, err = LoadTreeWithFix(boxID, p, luteEngine)
	return
}

// LoadTreeIdentityLocked is the ordinary-transaction variant of LoadTree.
func LoadTreeIdentityLocked(guard treenode.DocumentIdentityMutationGuard, boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	ret, _, err = LoadTreeWithFixIdentityLocked(guard, boxID, p, luteEngine)
	return
}

func LoadTreeByData(data []byte, boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	guard := treenode.LockDocumentIdentityMutation()
	defer guard.Unlock()
	return LoadTreeByDataIdentityLocked(guard, data, boxID, p, luteEngine)
}

// LoadTreeByDataIdentityLocked parses editor data while reusing the caller's
// ordinary document-identity transaction for any missing-parent repair.
func LoadTreeByDataIdentityLocked(guard treenode.DocumentIdentityMutationGuard, data []byte, boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	if err = treenode.ValidateDocumentIdentityMutationGuard(guard); err != nil {
		return nil, err
	}
	return loadTreeByData(data, boxID, p, luteEngine, true, guard)
}

// LoadTreeReadOnly loads and strictly validates the document currently stored
// at p without using the tree cache, repairing its payload, or rebuilding a
// missing parent document. It is intended for callers that already hold the
// exclusive document-identity lock and therefore must not re-enter an ordinary
// tree mutation through the legacy parent-rebuild path.
//
// Both encrypted and unencrypted notebooks use this same path: the stored
// bytes are bounded first, then decrypted when necessary, validated against
// the document ID in p, and finally parsed with side effects disabled.
func LoadTreeReadOnly(boxID, p string, luteEngine *lute.Lute, maxDocumentBytes int64) (ret *parse.Tree, err error) {
	const encryptionOverhead = int64(12 + 16) // AES-GCM nonce and tag
	if maxDocumentBytes < 2 || maxDocumentBytes > (1<<63-1)-encryptionOverhead-1 {
		return nil, errors.New("invalid maximum document size")
	}

	filePath := filepath.Join(util.DataDir, boxID, p)
	filelock.Lock(filePath)
	file, err := os.Open(filePath)
	if err != nil {
		filelock.Unlock(filePath)
		return nil, err
	}
	maxStoredBytes := maxDocumentBytes + encryptionOverhead
	data, readErr := io.ReadAll(io.LimitReader(file, maxStoredBytes+1))
	closeErr := file.Close()
	filelock.Unlock(filePath)
	if readErr != nil {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if int64(len(data)) > maxStoredBytes {
		return nil, errors.New("stored document size is outside the supported range")
	}
	if data, err = decryptData(boxID, p, data); err != nil {
		return nil, err
	}
	rootID := util.GetTreeID(p)
	document, err := ValidateDocumentBytes(data, rootID, maxDocumentBytes)
	if err != nil {
		return nil, err
	}
	return document.BindTree(boxID, p, luteEngine, true)
}

// LoadTreeReaderReadOnly strictly parses an unencrypted document stream
// without reopening its workspace path. Raw publication callers use this for
// a staged file while they hold that path's file lock, avoiding a recursive
// filelock acquisition between publication and index maintenance.
func LoadTreeReaderReadOnly(boxID, p string, reader io.Reader, size int64, luteEngine *lute.Lute, maxDocumentBytes int64) (*parse.Tree, error) {
	if maxDocumentBytes < 2 || maxDocumentBytes == 1<<63-1 || size < 2 || size > maxDocumentBytes {
		return nil, errors.New("document size is outside the supported range")
	}
	rootID := util.GetTreeID(p)
	document, err := ValidateDocument(reader, size, rootID, maxDocumentBytes)
	if err != nil {
		return nil, err
	}
	return document.BindTree(boxID, p, luteEngine, true)
}

// BindTree 将已验证 AST 绑定到目标笔记本和路径，可选地计算当前磁盘视图下的 HPath。
func (document *ValidatedDocument) BindTree(boxID, p string, luteEngine *lute.Lute, refreshHPath bool) (*parse.Tree, error) {
	if document == nil || document.Tree == nil || document.Tree.Root == nil {
		return nil, errors.New("validated document is nil")
	}
	rootID := util.GetTreeID(p)
	if document.Tree.Root.ID != rootID {
		return nil, fmt.Errorf("validated document root does not match %s", rootID)
	}
	tree := document.Tree
	tree.Box = boxID
	tree.Path = p
	tree.Root.Path = p
	if refreshHPath {
		if err := refreshTreeHPath(tree, luteEngine, false, nil); err != nil {
			return nil, err
		}
	}
	return tree, nil
}

func loadTreeByData(data []byte, boxID, p string, luteEngine *lute.Lute, rebuildMissingParents bool, guard treenode.DocumentIdentityMutationGuard) (ret *parse.Tree, err error) {
	ret, err = parseJSON2Tree(boxID, p, data, luteEngine)
	if nil != err {
		logging.LogErrorf("parse tree [%s] failed: %s", p, err)
		return
	}
	ret.Path = p
	ret.Root.Path = p
	err = refreshTreeHPath(ret, luteEngine, rebuildMissingParents, guard)
	return
}

// RefreshTreeHPathReadOnly 根据当前已发布的父文档元数据重新计算树的层级路径。
func RefreshTreeHPathReadOnly(tree *parse.Tree, luteEngine *lute.Lute) error {
	return refreshTreeHPath(tree, luteEngine, false, nil)
}

func RefreshTreeHPathWithOverlay(tree *parse.Tree, luteEngine *lute.Lute, titles map[string]string) error {
	return refreshTreeHPathWithOverlay(tree, luteEngine, false, nil, titles)
}

func DocumentTitleOverlayKey(boxID, documentPath string) string {
	return boxID + path.Clean("/"+strings.TrimPrefix(filepath.ToSlash(documentPath), "/"))
}

func refreshTreeHPath(tree *parse.Tree, luteEngine *lute.Lute, rebuildMissingParents bool, guard treenode.DocumentIdentityMutationGuard) error {
	return refreshTreeHPathWithOverlay(tree, luteEngine, rebuildMissingParents, guard, nil)
}

func refreshTreeHPathWithOverlay(tree *parse.Tree, luteEngine *lute.Lute, rebuildMissingParents bool,
	guard treenode.DocumentIdentityMutationGuard, titles map[string]string) error {
	if tree == nil || tree.Root == nil {
		return errors.New("tree is nil")
	}
	hPath := "/" + strings.TrimPrefix(filepath.ToSlash(tree.Path), "/")
	parts := strings.Split(hPath, "/")
	if len(parts) < 2 {
		return errors.New("invalid path")
	}

	parts = parts[1 : len(parts)-1] // 去掉开头的斜杆和结尾的自己
	if 1 > len(parts) {
		tree.HPath = "/" + tree.Root.IALAttr("title")
		tree.Hash = treenode.NodeHash(tree.Root, tree, luteEngine)
		return nil
	}

	// 构造 HPath
	hPathBuilder := bytes.Buffer{}
	hPathBuilder.WriteString("/")
	for i := range parts {
		var parentAbsPath string
		if 0 < i {
			parentAbsPath = strings.Join(parts[:i+1], "/")
		} else {
			parentAbsPath = parts[0]
		}
		parentAbsPath += ".sy"
		parentPath := parentAbsPath
		parentAbsPath = filepath.Join(util.DataDir, tree.Box, parentAbsPath)

		var parentDocIAL map[string]string
		if title, exists := titles[DocumentTitleOverlayKey(tree.Box, parentPath)]; exists {
			parentDocIAL = map[string]string{"title": title}
		} else if rebuildMissingParents {
			parentDocIAL = DocIAL(parentAbsPath)
		} else if _, statErr := os.Lstat(parentAbsPath); statErr == nil {
			parentDocIAL = DocIAL(parentAbsPath)
		} else if !os.IsNotExist(statErr) {
			logging.LogErrorf("inspect parent tree [%s] failed: %s", parentAbsPath, statErr)
		}
		if 1 > len(parentDocIAL) {
			if rebuildMissingParents {
				// 子文档缺失父文档时自动补全 https://github.com/siyuan-note/siyuan/issues/7376
				parentTree := treenode.NewTree(tree.Box, parentPath, hPathBuilder.String()+"Untitled", "Untitled")
				if _, writeErr := WriteTreeIdentityLocked(guard, parentTree); nil != writeErr {
					logging.LogErrorf("rebuild parent tree [%s] failed: %s", parentAbsPath, writeErr)
				} else {
					logging.LogInfof("rebuilt parent tree [%s]", parentAbsPath)
					if upsertErr := treenode.UpsertBlockTreeMutationLocked(guard, parentTree); upsertErr != nil {
						logging.LogErrorf("index rebuilt parent tree [%s] failed: %s", parentAbsPath, upsertErr)
					}
				}
			}
			hPathBuilder.WriteString("Untitled/")
			continue
		}

		title := parentDocIAL["title"]
		if "" == title {
			title = "Untitled"
		}
		hPathBuilder.WriteString(title)
		hPathBuilder.WriteString("/")
	}
	hPathBuilder.WriteString(tree.Root.IALAttr("title"))
	tree.HPath = hPathBuilder.String()
	tree.Hash = treenode.NodeHash(tree.Root, tree, luteEngine)
	return nil
}

func DocIAL(absPath string) (ret map[string]string) {
	// 加密笔记本的 .sy 是密文，流式 jsoniter 解析无法处理，需先整体读+解密。
	// 反推 boxID：路径形如 <DataDir>/<boxID>/...；非加密笔记本走原流式逻辑。
	boxID := docIALBoxID(absPath)
	if boxID != "" && DEKProvider != nil {
		if dek, err := DEKProvider(boxID); err == nil && dek != nil {
			// 已解锁的加密 box：整体读密文 → 解密 → 流式解析
			// 注意：filelock.ReadFile 内部已加锁，不能在外面再 Lock/Unlock（会死锁）
			raw, readErr := filelock.ReadFile(absPath)
			if readErr != nil {
				logging.LogErrorf("read file [%s] failed: %s", absPath, readErr)
				return nil
			}
			relPath := filepath.ToSlash(strings.TrimPrefix(absPath, filepath.Join(util.DataDir, boxID)+string(os.PathSeparator)))
			plain, decErr := decryptData(boxID, relPath, raw)
			if decErr != nil {
				// 解密失败（可能文件损坏或密钥不匹配）：返回空 map 而非 nil，
				// 避免 LoadTreeByData 的父文档补全逻辑把 nil 误判为"文档缺失"而凭空创建文档
				logging.LogErrorf("decrypt doc [%s] for IAL failed: %s", absPath, decErr)
				return map[string]string{}
			}
			iter := jsoniter.Parse(jsoniter.ConfigCompatibleWithStandardLibrary, bytes.NewReader(plain), 512)
			for field := iter.ReadObject(); field != ""; field = iter.ReadObject() {
				if field == "Properties" {
					iter.ReadVal(&ret)
					break
				} else {
					iter.Skip()
				}
			}
			for k, v := range ret {
				ret[k] = html.UnescapeAttrVal(v)
			}
			return
		}
	}

	filelock.Lock(absPath)
	file, err := os.Open(absPath)
	if err != nil {
		logging.LogErrorf("open file [%s] failed: %s", absPath, err)
		filelock.Unlock(absPath)
		return nil
	}

	iter := jsoniter.Parse(jsoniter.ConfigCompatibleWithStandardLibrary, file, 512)
	for field := iter.ReadObject(); field != ""; field = iter.ReadObject() {
		if field == "Properties" {
			iter.ReadVal(&ret)
			break
		} else {
			iter.Skip()
		}
	}
	file.Close()
	filelock.Unlock(absPath)

	for k, v := range ret {
		ret[k] = html.UnescapeAttrVal(v)
	}
	return
}

func TreeSize(tree *parse.Tree) (size uint64) {
	luteEngine := util.NewLute() // 不关注用户的自定义解析渲染选项
	renderer := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	return uint64(len(renderer.Render()))
}

func WriteTree(tree *parse.Tree) (size uint64, err error) {
	guard := treenode.LockDocumentIdentityMutation()
	defer guard.Unlock()
	return WriteTreeIdentityLocked(guard, tree)
}

// WriteTreeIdentityLocked publishes one ordinary editor tree while reusing the
// caller's opaque document-identity mutation guard. Callers which also update
// blocktree rows must use this variant so an exclusive raw publication cannot
// interleave between the index and filesystem halves of the transaction.
func WriteTreeIdentityLocked(guard treenode.DocumentIdentityMutationGuard, tree *parse.Tree) (size uint64, err error) {
	if err = treenode.ValidateDocumentIdentityMutationGuard(guard); err != nil {
		return 0, err
	}
	data, filePath, err := prepareWriteTreeIdentityLocked(guard, tree)
	if err != nil {
		return
	}

	// 加密笔记本的落盘内容用密文 encData，缓存与比对仍用明文 data（缓存存明文）
	encData, encErr := encryptData(tree.Box, tree.Path, data)
	if encErr != nil {
		err = encErr
		return
	}

	// 缓存与待写入数据一致时跳过落盘；缓存未命中时再读盘比对，避免无变更的重复写入
	if cachedData, ok := cache.GetTreeDataInBox(tree.ID, tree.Box); ok {
		if len(cachedData) == len(data) && bytes.Equal(cachedData, data) {
			return
		}
	} else {
		// 读盘比对：加密笔记本的磁盘数据是密文，需先解密成明文再与 data 比对
		if diskData, readErr := filelock.ReadFile(filePath); nil == readErr {
			decDisk, decErr := decryptData(tree.Box, tree.Path, diskData)
			if decErr == nil && len(decDisk) == len(data) && bytes.Equal(decDisk, data) {
				cache.SetTreeDataInBox(tree.ID, tree.Box, data)
				return
			}
		}
	}

	if err = util.WriteFileByMmap(filePath, encData); nil != err {
		if err = writeTreeByWriteFile(filePath, encData); nil != err {
			return
		}
	}

	if util.ExceedLargeFileWarningSize(len(data)) {
		msg := fmt.Sprintf(util.Langs[util.Lang][268], tree.Root.IALAttr("title")+" "+filepath.Base(filePath), util.LargeFileWarningSize)
		util.PushErrMsg(msg, 7000)
	}

	cache.SetTreeDataInBox(tree.ID, tree.Box, data)
	afterWriteTree(tree)
	size = uint64(len(data))
	return
}

func writeTreeByWriteFile(filePath string, data []byte) (err error) {
	if err = filelock.WriteFile(filePath, data); err != nil {
		msg := fmt.Sprintf("write data [%s] failed: %s", filePath, err)
		logging.LogErrorf("%s", msg)
		err = errors.New(msg)
		return
	}
	return
}

func prepareWriteTreeIdentityLocked(guard treenode.DocumentIdentityMutationGuard, tree *parse.Tree) (data []byte, filePath string, err error) {
	luteEngine := util.NewLute() // 不关注用户的自定义解析渲染选项

	if nil == tree.Root.FirstChild {
		newP := treenode.NewParagraph("")
		tree.Root.AppendChild(newP)
		tree.Root.SetIALAttr("updated", util.TimeFromID(newP.ID))
		if err = treenode.UpsertBlockTreeMutationLocked(guard, tree); err != nil {
			return nil, "", err
		}
	}

	treenode.UpgradeSpec(tree)

	if _, err = ValidateBoxRelativePath(tree.Box, tree.Path); err != nil {
		return
	}

	filePath = filepath.Join(util.DataDir, tree.Box, tree.Path)
	tree.Root.SetIALAttr("type", "doc")
	renderer := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	data = renderer.Render()
	data, _ = removeUnescapedUnicodeNull(data)
	if !util.UseSingleLineSave {
		buf := bytes.Buffer{}
		buf.Grow(1024 * 1024 * 2)
		if err = json.Indent(&buf, data, "", "\t"); err != nil {
			logging.LogErrorf("json indent failed: %s", err)
			return
		}
		data = buf.Bytes()
	}

	if err = os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return
	}
	return
}

// removeUnescapedUnicodeNull 只移除未被转义的 `\u0000` 字面序列。
// 判断方法：在匹配到 `\u0000` 时向前数连续的 `\` 个数，若为偶数则视为未转义并移除。
func removeUnescapedUnicodeNull(data []byte) (ret []byte, needFix bool) {
	patLen := 6 // len(`\u0000`)
	n := len(data)
	if n < patLen {
		return data, false
	}
	if !bytes.Contains(data, []byte(`\u0000`)) {
		return data, false
	}

	dst := make([]byte, 0, n)
	i := 0
	for i < n {
		from := i
		j := bytes.IndexByte(data[i:], '\\')
		if j < 0 {
			dst = append(dst, data[from:]...)
			break
		}
		i += j
		dst = append(dst, data[from:i]...)

		// 快速检查是否可能匹配 `\u0000`
		if i+patLen <= n &&
			data[i+1] == 'u' &&
			data[i+2] == '0' &&
			data[i+3] == '0' &&
			data[i+4] == '0' &&
			data[i+5] == '0' {
			// 统计当前 `\` 之前连续的反斜杠数量
			backslashes := 0
			for k := i - 1; k >= 0 && data[k] == '\\'; k-- {
				backslashes++
			}
			// 若为偶数，则当前 `\` 未被转义，跳过整个 `\u0000`
			if backslashes%2 == 0 {
				i += patLen
				continue
			}
		}
		// 否则保留当前字节
		dst = append(dst, data[i])
		i++
	}
	return dst, len(dst) != n
}

func afterWriteTree(tree *parse.Tree) {
	docIAL := parse.IAL2Map(tree.Root.KramdownIAL)
	cache.PutDocIALInBox(tree.Path, tree.Box, docIAL)
}

// fixTreeJSONData 订正树 JSON 数据。
func fixTreeJSONData(boxID, p string, jsonData []byte, luteEngine *lute.Lute) (data []byte, needFix bool, err error) {
	jsonData, needFix = removeUnescapedUnicodeNull(jsonData)
	ret, parseNeedFix, err := dataparser.ParseJSON(jsonData, luteEngine.ParseOptions)
	if parseNeedFix {
		needFix = true
	}
	if err != nil {
		logging.LogErrorf("parse json [%s] to tree failed: %s", boxID+p, err)
		err = fmt.Errorf("parse json [%s] to tree failed: %w", boxID+p, err)
		return
	}

	ret.Box = boxID
	ret.Path = p

	if err = treenode.CheckSpec(ret); errors.Is(err, treenode.ErrSpecTooNew) {
		return
	}

	if treenode.UpgradeSpec(ret) {
		needFix = true
	}

	// v3.5.1 https://github.com/siyuan-note/siyuan/pull/16657 引入的问题，属性值未转义
	// v3.5.2 https://github.com/siyuan-note/siyuan/issues/16686 进行了修复，并加了订正逻辑 https://github.com/siyuan-note/siyuan/pull/16712
	// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-ff66-236v-p4fg XSS 漏洞："title": "&amp;\" onmouseenter=\"require('child_process').exec('calc')"
	if escapeAttributeValues(ret) {
		needFix = true
	}

	if pathID := util.GetTreeID(p); pathID != ret.Root.ID {
		if encryptedBox(boxID) {
			// 加密 .sy：基名 ID（pathID）必须与解密后的根块 ID 一致。不一致说明密文被替换、
			// 文件名被篡改或 AAD 认证被绕过，不得静默修正——fail-closed，符合加密笔记本威胁模型。
			err = fmt.Errorf("encrypted .sy [%s]: base id [%s] != root id [%s]", p, pathID, ret.Root.ID)
			logging.LogErrorf("%s", err)
			return
		}
		needFix = true
		logging.LogInfof("reset tree id from [%s] to [%s]", ret.Root.ID, pathID)
		ret.Root.ID = pathID
		ret.ID = pathID
		ret.Root.SetIALAttr("id", ret.ID)
	}

	if !needFix {
		return jsonData, false, nil
	}

	renderer := render.NewJSONRenderer(ret, luteEngine.RenderOptions, luteEngine.ParseOptions)
	data = renderer.Render()

	if !util.UseSingleLineSave {
		buf := bytes.Buffer{}
		buf.Grow(1024 * 1024 * 2)
		if err = json.Indent(&buf, data, "", "\t"); err != nil {
			return
		}
		data = buf.Bytes()
	}

	filePath := filepath.Join(util.DataDir, ret.Box, ret.Path)
	if err = os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return
	}
	// 订正后的 data 是明文，加密笔记本落盘前需加密
	encData, encErr := encryptData(ret.Box, ret.Path, data)
	if encErr != nil {
		err = encErr
		return
	}
	if err = filelock.WriteFile(filePath, encData); err != nil {
		logging.LogErrorf("write data [%s] failed: %s", filePath, err)
	}
	return
}

func parseJSON2Tree(boxID, p string, jsonData []byte, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	ret, _, err = parseJSON2TreeWithFixState(boxID, p, jsonData, luteEngine)
	return
}

func parseJSON2TreeWithFixState(boxID, p string, jsonData []byte, luteEngine *lute.Lute) (ret *parse.Tree, needFix bool, err error) {
	ret, needFix, err = dataparser.ParseJSON(jsonData, luteEngine.ParseOptions)
	if err != nil {
		logging.LogErrorf("parse json [%s] to tree failed: %s", boxID+p, err)
		err = fmt.Errorf("parse json [%s] to tree failed: %w", boxID+p, err)
		return
	}

	ret.Box = boxID
	ret.Path = p

	if err = treenode.CheckSpec(ret); errors.Is(err, treenode.ErrSpecTooNew) {
		return
	}
	return
}

// escapeAttributeValues 转义属性值
func escapeAttributeValues(tree *parse.Tree) (hasEscaped bool) {
	if nil == tree || nil == tree.Root {
		return false
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() || "" == n.ID || 0 == len(n.KramdownIAL) {
			return ast.WalkContinue
		}

		if escaped := escapeNodeAttributeValues(n); escaped {
			hasEscaped = true
		}
		return ast.WalkContinue
	})
	return hasEscaped
}

// escapeNodeAttributeValues 转义节点的属性值
func escapeNodeAttributeValues(node *ast.Node) (escaped bool) {
	if nil == node || 0 == len(node.KramdownIAL) {
		return false
	}

	for _, kv := range node.KramdownIAL {
		// 解码再编码后发生变化则说明未正确转义或存在恶意拼接，需要订正
		canonical := html.EscapeAttrVal(html.UnescapeAttrVal(kv[1]))
		if canonical != kv[1] {
			kv[1] = canonical
			escaped = true
		}
	}
	return
}
