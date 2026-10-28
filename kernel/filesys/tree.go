// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
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
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
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

// validateTreePath 限制文档读写只访问以块 ID 命名的文档及其父目录，避免订正逻辑覆盖内部配置。
func validateTreePath(boxID, p string) error {
	_, err := validateTreePathMode(boxID, p)
	return err
}

// validateTreePathMode 在本次源访问开始时检查身份和能力，解析同一份来源时复用该模式。
func validateTreePathMode(boxID, p string) (int, error) {
	if !ast.IsNodeIDPattern(boxID) {
		return 0, fmt.Errorf("invalid notebook ID [%s]", boxID)
	}
	rel, err := ValidateBoxRelativePath(boxID, p)
	if err != nil {
		return 0, err
	}
	if !strings.HasSuffix(rel, ".sy") {
		return 0, fmt.Errorf("invalid document path [%s]", p)
	}
	for id := range strings.SplitSeq(strings.TrimSuffix(rel, ".sy"), "/") {
		if !ast.IsNodeIDPattern(id) {
			return 0, fmt.Errorf("invalid document path [%s]", p)
		}
	}
	return DocumentAddressingMode(boxID)
}

func LoadTreeWithFix(boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, needFix bool, err error) {
	mode, err := validateTreePathMode(boxID, p)
	if err != nil {
		logging.LogErrorf("cannot load tree [%s] for box [%s]: %s", p, boxID, err)
		return
	}

	dek, encrypted, releaseCryptoLease, leaseErr := acquireCryptoLease(boxID)
	if leaseErr != nil {
		err = leaseErr
		return
	}
	defer releaseCryptoLease()

	rootID := util.GetTreeID(p)
	filePath := filepath.Join(util.DataDir, boxID, p)
	if raw, ok := cache.GetTreeDataInBox(rootID, boxID); ok {
		// 内容缓存不代表请求路径仍然有效，移动或删除后的旧路径不能触发补树。
		if err = checkTreeFile(filePath); err != nil {
			return
		}
		ret, err = loadTreeByDataInMode(raw, boxID, p, luteEngine, mode)
		return
	}

	readVersion := cache.TreeDataReadVersion()
	data, err := filelock.ReadFile(filePath)
	if nil != err {
		if !os.IsNotExist(err) {
			logging.LogErrorf("load tree [%s] failed: %s", p, err)
		}
		return
	}

	// 加密笔记本的 .sy 是密文，读盘后解密成明文供后续解析；非加密笔记本原样返回
	if data, err = decryptDataWithDEK(boxID, p, data, dek); nil != err {
		logging.LogErrorf("decrypt tree [%s] failed: %s", p, err)
		return
	}

	data, needFix, err = fixTreeJSONDataInMode(boxID, p, data, luteEngine, dek, encrypted, true, mode)
	if nil != err {
		return
	}

	ret, err = loadTreeByDataInMode(data, boxID, p, luteEngine, mode)
	if nil == err {
		cache.SetTreeDataFromReadInBox(rootID, boxID, data, readVersion)
	}
	return
}

func LoadTree(boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	ret, _, err = LoadTreeWithFix(boxID, p, luteEngine)
	return
}

// NormalizeTreeForRead 对只读树应用与文件加载一致的规范化处理，但不写回磁盘。
func NormalizeTreeForRead(tree *parse.Tree) (err error) {
	if nil == tree || nil == tree.Root {
		return errors.New("tree is empty")
	}
	if err = checkDocumentTreeSpec(tree); nil != err {
		return
	}
	return normalizeValidatedTreeForRead(tree)
}

// normalizeValidatedTreeForRead 的调用方已检查源规格及树根；只调整内存中的展示投影。
func normalizeValidatedTreeForRead(tree *parse.Tree) (err error) {
	if err = treenode.RefreshTableCellRichProjection(tree.Root); nil != err {
		return
	}
	treenode.UpgradeSpec(tree)
	escapeAttributeValues(tree)
	return
}

func LoadTreeByData(data []byte, boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	mode, err := validateTreePathMode(boxID, p)
	if err != nil {
		return
	}
	return loadTreeByDataInMode(data, boxID, p, luteEngine, mode)
}

func loadTreeByDataInMode(data []byte, boxID, p string, luteEngine *lute.Lute, mode int) (ret *parse.Tree, err error) {
	ret, err = parseJSON2TreeInMode(boxID, p, data, luteEngine, mode)
	if nil != err {
		logging.LogErrorf("parse tree [%s] failed: %s", p, err)
		return
	}
	ret.Path = p
	ret.Root.Path = p

	hPath := "/" + strings.TrimPrefix(filepath.ToSlash(p), "/")
	parts := strings.Split(hPath, "/")
	if len(parts) < 2 {
		logging.LogErrorf("parse tree [%s] failed: invalid path", p)
		err = errors.New("invalid path")
		return
	}

	parts = parts[1 : len(parts)-1] // 去掉开头的斜杆和结尾的自己
	if 1 > len(parts) {
		ret.HPath = "/" + treenode.ReadDocumentTitle(ret.Root).Text
		ret.Hash = treenode.NodeHash(ret.Root, ret, luteEngine)
		return
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
		parentAbsPath = filepath.Join(util.DataDir, boxID, parentAbsPath)

		parentHeader, parentErr := readDocumentHeaderInMode(parentAbsPath, false, mode)
		if parentErr != nil && !errors.Is(parentErr, os.ErrNotExist) {
			return nil, parentErr
		}
		if errors.Is(parentErr, os.ErrNotExist) {
			// 直接解析数据的调用也必须确认子文档仍在磁盘上，避免旧数据重建已删除的父链。
			if err = checkTreeFile(filepath.Join(util.DataDir, boxID, p)); err != nil {
				return nil, err
			}
			// 子文档缺失父文档时自动补全 https://github.com/siyuan-note/siyuan/issues/7376
			parentTree := treenode.NewTree(boxID, parentPath, hPathBuilder.String()+"Untitled", "Untitled")
			if _, writeErr := WriteTree(parentTree); nil != writeErr {
				logging.LogErrorf("rebuild parent tree [%s] failed: %s", parentAbsPath, writeErr)
				return nil, writeErr
			} else {
				logging.LogInfof("rebuilt parent tree [%s]", parentAbsPath)
				treenode.UpsertBlockTree(parentTree)
			}
			hPathBuilder.WriteString("Untitled/")
			continue
		}

		title := parentHeader.Properties["title"]
		if "" == title {
			title = "Untitled"
		}
		hPathBuilder.WriteString(title)
		hPathBuilder.WriteString("/")
	}
	hPathBuilder.WriteString(treenode.ReadDocumentTitle(ret.Root).Text)
	ret.HPath = hPathBuilder.String()
	ret.Hash = treenode.NodeHash(ret.Root, ret, luteEngine)
	return
}

func checkTreeFile(absPath string) error {
	info, err := os.Stat(absPath)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("invalid document file [%s]", absPath)
	}
	return nil
}

// readParentDocIAL 区分父文档缺失与读取、认证、解析失败，只有缺失才允许补树。
func readParentDocIAL(absPath string) (map[string]string, error) {
	return readDocIAL(absPath, false)
}

func readDocIAL(absPath string, strict bool) (map[string]string, error) {
	doc, err := readDocumentHeader(absPath, strict)
	if err != nil {
		return nil, err
	}
	return doc.Properties, nil
}

type documentHeader struct {
	ID         string
	Type       string
	Spec       string
	Properties map[string]string
}

func readDocumentHeader(absPath string, strict bool) (*documentHeader, error) {
	boxID := util.BoxIDFromDataPath(absPath)
	mode, err := DocumentAddressingMode(boxID)
	if err != nil {
		return nil, err
	}
	return readDocumentHeaderInMode(absPath, strict, mode)
}

func readDocumentHeaderInMode(absPath string, strict bool, mode int) (*documentHeader, error) {
	boxID := util.BoxIDFromDataPath(absPath)
	dek, _, release, err := acquireCryptoLease(boxID)
	if err != nil {
		return nil, err
	}
	defer release()
	data, err := filelock.ReadFile(absPath)
	if err != nil {
		return nil, err
	}
	relPath, err := filepath.Rel(filepath.Join(util.DataDir, boxID), absPath)
	if err != nil {
		return nil, err
	}
	data, err = decryptDataWithDEK(boxID, filepath.ToSlash(relPath), data, dek)
	if err != nil {
		return nil, err
	}
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	if err = treenode.CheckSpecJSON(data); err != nil {
		return nil, err
	}
	var doc documentHeader
	if err = json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parse parent document [%s]: %w", absPath, err)
	}
	if strict && (doc.ID != util.GetTreeID(absPath) || doc.Type != "NodeDocument") {
		return nil, fmt.Errorf("invalid document identity [%s]", absPath)
	}
	if len(doc.Properties) == 0 {
		return nil, fmt.Errorf("missing parent document properties [%s]", absPath)
	}
	for key, value := range doc.Properties {
		doc.Properties[key] = html.UnescapeAttrVal(value)
	}
	return &doc, nil
}

var ErrInvalidDocIAL = errors.New("invalid document properties")

func DocIAL(absPath string) (ret map[string]string, err error) {
	// 加密笔记本的 .sy 是密文，流式 jsoniter 解析无法处理，需先整体读+解密。
	// 反推 boxID：路径形如 <DataDir>/<boxID>/...；非加密笔记本走原流式逻辑。
	boxID := util.BoxIDFromDataPath(absPath)
	mode, err := DocumentAddressingMode(boxID)
	if err != nil {
		return nil, err
	}
	if boxID != "" && DEKProvider != nil {
		dek, encrypted, releaseCryptoLease, leaseErr := acquireCryptoLease(boxID)
		if leaseErr != nil {
			return nil, leaseErr
		}
		defer releaseCryptoLease()
		if encrypted {
			// 已解锁的加密 box：整体读密文 → 解密 → 流式解析
			// 注意：filelock.ReadFile 内部已加锁，不能在外面再 Lock/Unlock（会死锁）
			raw, readErr := filelock.ReadFile(absPath)
			if readErr != nil {
				if !errors.Is(readErr, os.ErrNotExist) {
					logging.LogErrorf("read file [%s] failed: %s", absPath, readErr)
				}
				return nil, readErr
			}
			relPath := filepath.ToSlash(strings.TrimPrefix(absPath, filepath.Join(util.DataDir, boxID)+string(os.PathSeparator)))
			plain, decErr := decryptDataWithDEK(boxID, relPath, raw, dek)
			if decErr != nil {
				// 属性查询不返回未认证的数据；需要区分缺失与错误的补树流程使用 readParentDocIAL。
				logging.LogErrorf("decrypt doc [%s] for IAL failed: %s", absPath, decErr)
				return nil, decErr
			}
			return parseDocIALForMode(bytes.NewReader(plain), mode)
		}
	}

	filelock.Lock(absPath)
	defer filelock.Unlock(absPath)
	file, err := os.Open(absPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logging.LogErrorf("open file [%s] failed: %s", absPath, err)
		}
		return nil, err
	}
	defer file.Close()
	return parseDocIALForMode(file, mode)
}

// docIALReader 保留底层读取错误，避免将临时 I/O 失败当成 JSON 损坏。
type docIALReader struct {
	io.Reader
	err error
}

func (r *docIALReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	if err != nil && err != io.EOF {
		r.err = err
	}
	return n, err
}

func parseDocIAL(reader io.Reader) (ret map[string]string, err error) {
	return parseDocIALForMode(reader, 1)
}

func parseDocIALForMode(reader io.Reader, mode int) (ret map[string]string, err error) {
	r := &docIALReader{Reader: reader}
	buffered := bufio.NewReaderSize(r, 512)
	if prefix, _ := buffered.Peek(3); bytes.Equal(prefix, []byte("\xef\xbb\xbf")) {
		_, _ = buffered.Discard(3)
	}
	iter := jsoniter.Parse(jsoniter.ConfigCompatibleWithStandardLibrary, buffered, 512)
	var specErr, titleErr error
	var properties []byte
	iter.ReadObjectCB(func(iter *jsoniter.Iterator, field string) bool {
		switch {
		case strings.EqualFold(field, "Spec"):
			var spec string
			iter.ReadVal(&spec)
			if iter.Error != nil {
				specErr = errors.New("invalid document spec")
			} else if checkErr := treenode.CheckSpec(&parse.Tree{Root: &ast.Node{Spec: spec}}); checkErr != nil {
				specErr = checkErr
			}
		case field == "Properties":
			properties = iter.SkipAndReturnBytes()
			if _, checkErr := documentaddressing.CheckTitleProperties(properties); checkErr != nil && titleErr == nil {
				titleErr = checkErr
			}
		default:
			iter.Skip()
		}
		return iter.Error == nil
	})
	if iter.Error == nil {
		iter.WhatIsNext()
	}
	if r.err != nil {
		return nil, r.err
	}
	// 属性可以排在版本之前，完整检查根对象后才能返回，版本错误不能进入属性修复。
	if specErr != nil {
		return nil, specErr
	}
	if iter.Error != io.EOF {
		return nil, ErrInvalidDocIAL
	}
	if titleErr != nil {
		return nil, titleErr
	}
	// 先校验源版本，再按当前属性结构解码，避免把未来版本的属性表示当成损坏数据。
	if err = jsoniter.ConfigCompatibleWithStandardLibrary.Unmarshal(properties, &ret); err != nil || len(ret) == 0 {
		return nil, ErrInvalidDocIAL
	}

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
	return WriteTreeWithPreflight(tree, nil)
}

// WriteTreeWithPreflight 在源写入协调范围内检查业务条件，检查失败时不创建目录或发布缓存。
func WriteTreeWithPreflight(tree *parse.Tree, preflight func() error) (size uint64, err error) {
	unlock := lockDocumentSource()
	defer unlock()
	if preflight != nil {
		if err = preflight(); err != nil {
			return
		}
	}
	timing := util.BeginPerformance("document.save")
	defer timing.Finish()
	data, filePath, err := prepareWriteTree(tree)
	if err != nil {
		return
	}

	timing.Count("bytes", int64(len(data)))
	timing.Stage("encrypt")
	dek, encrypted, releaseCryptoLease, leaseErr := acquireCryptoLease(tree.Box)
	if leaseErr != nil {
		err = leaseErr
		return
	}
	defer releaseCryptoLease()

	// 加密笔记本的落盘内容用密文 encData，缓存与比对仍用明文 data（缓存存明文）
	encData, encErr := encryptDataWithDEK(tree.Box, tree.Path, data, dek)
	if encErr != nil {
		err = encErr
		return
	}
	recorder := treeRecorder(tree)
	if recorder != nil {
		if err = recorder.record(encData); err != nil {
			return 0, err
		}
	}
	pending, metadataErr := treenode.BeginDocumentMetadataWrite(tree)
	if metadataErr != nil {
		return 0, metadataErr
	}
	defer finishDocumentMetadataWrite(tree, pending, &err)

	// 缓存与待写入数据一致时跳过落盘；缓存未命中时再读盘比对，避免无变更的重复写入
	timing.Stage("compare")
	var validatedSource []byte
	if cachedData, ok := cache.GetTreeDataInBox(tree.ID, tree.Box); ok && recorder == nil {
		if len(cachedData) == len(data) && bytes.Equal(cachedData, data) {
			return
		}
		validatedSource = cachedData
	} else if recorder == nil {
		// 读盘比对：加密笔记本的磁盘数据是密文，需先解密成明文再与 data 比对
		if diskData, readErr := filelock.ReadFile(filePath); nil == readErr {
			decDisk, decErr := decryptDataWithDEK(tree.Box, tree.Path, diskData, dek)
			if decErr == nil && len(decDisk) == len(data) && bytes.Equal(decDisk, data) {
				cache.SetTreeDataInBox(tree.ID, tree.Box, data)
				return
			}
		}
	}

	timing.Stage("write")
	err = util.WriteFileWithPreflight(filePath, encData, !encrypted && recorder == nil, func(current []byte) error {
		if recorder != nil && !bytes.Equal(current, recorder.before) {
			return fmt.Errorf("%w: %s", util.ErrFileChanged, filePath)
		}
		if current == nil {
			return nil
		}
		plain, readErr := decryptDataWithDEK(tree.Box, tree.Path, current, dek)
		if readErr != nil {
			return readErr
		}
		// 缓存只在成功读取或写入后发布；磁盘认证结果完全一致时复用已验证的源。
		if validatedSource != nil && bytes.Equal(plain, validatedSource) {
			return nil
		}
		return CheckDocumentSpecJSON(tree.Box, plain)
	})
	if err != nil {
		return
	}

	if util.ExceedLargeFileWarningSize(len(data)) {
		msg := fmt.Sprintf(util.Langs[util.Lang][268], treenode.ReadDocumentTitle(tree.Root).Text+" "+filepath.Base(filePath), util.LargeFileWarningSize.Load())
		util.PushErrMsg(msg, 7000)
	}

	timing.Stage("notify")
	timing.Count("written_bytes", int64(len(data)))
	cache.SetTreeDataInBox(tree.ID, tree.Box, data)
	afterWriteTree(tree)
	size = uint64(len(data))
	return
}

func prepareWriteTree(tree *parse.Tree) (data []byte, filePath string, err error) {
	_, err = validateTreePathMode(tree.Box, tree.Path)
	if err != nil {
		return
	}
	if err = treenode.SyncTableCellRichInlineChanges(tree.Root); nil != err {
		return
	}
	if err = treenode.CheckSpec(tree); nil != err {
		return
	}
	luteEngine := util.NewLute() // 不关注用户的自定义解析渲染选项

	if nil == tree.Root.FirstChild {
		newP := treenode.NewParagraph("")
		tree.Root.AppendChild(newP)
		tree.Root.SetIALAttr("updated", util.TimeFromID(newP.ID))
		treenode.UpsertBlockTreePending(tree)
	}

	if treenode.NormalizeTabs(tree.Root) {
		treenode.UpsertBlockTreePending(tree)
	}
	treenode.UpgradeSpec(tree)

	filePath = filepath.Join(util.DataDir, tree.Box, tree.Path)
	tree.Root.SetIALAttr("type", "doc")
	renderer := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	data = renderer.Render()
	data, _ = removeUnescapedUnicodeNull(data)
	if !util.UseSingleLineSave.Load() {
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
func fixTreeJSONData(boxID, p string, jsonData []byte, luteEngine *lute.Lute, dek []byte, encrypted, persist bool) (data []byte, needFix bool, err error) {
	mode, err := validateTreePathMode(boxID, p)
	if err != nil {
		return
	}
	return fixTreeJSONDataInMode(boxID, p, jsonData, luteEngine, dek, encrypted, persist, mode)
}

func fixTreeJSONDataInMode(boxID, p string, jsonData []byte, luteEngine *lute.Lute, dek []byte, encrypted, persist bool, mode int) (data []byte, needFix bool, err error) {
	// 这里只处理解密后的 JSON，密文必须先通过认证，订正成功后才允许写回。
	originalJSON := jsonData
	withoutBOM := bytes.TrimPrefix(jsonData, []byte("\xef\xbb\xbf"))
	needFix = len(withoutBOM) != len(jsonData)
	jsonData = withoutBOM
	if err = treenode.CheckSpecJSON(jsonData); nil != err {
		return
	}
	jsonData, removedNull := removeUnescapedUnicodeNull(jsonData)
	needFix = needFix || removedNull
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

	if err = treenode.CheckSpec(ret); nil != err {
		return
	}
	if err = treenode.RefreshTableCellRichProjection(ret.Root); nil != err {
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
		if encrypted {
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
	if treenode.FixInvalidListChildren(ret.Root) {
		needFix = true
	}
	if treenode.NormalizeTabs(ret.Root) {
		needFix = true
	}

	if !needFix {
		return jsonData, false, nil
	}

	renderer := render.NewJSONRenderer(ret, luteEngine.RenderOptions, luteEngine.ParseOptions)
	data = renderer.Render()

	if !util.UseSingleLineSave.Load() {
		buf := bytes.Buffer{}
		buf.Grow(1024 * 1024 * 2)
		if err = json.Indent(&buf, data, "", "\t"); err != nil {
			return
		}
		data = buf.Bytes()
	}

	if !persist {
		return
	}
	filePath := filepath.Join(util.DataDir, ret.Box, ret.Path)
	if err = os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return
	}
	// 订正后的 data 是明文，加密笔记本落盘前需加密
	encData, encErr := encryptDataWithDEK(ret.Box, ret.Path, data, dek)
	if encErr != nil {
		err = encErr
		return
	}
	err = util.WriteFileWithPreflight(filePath, encData, false, func(current []byte) error {
		plain, readErr := decryptDataWithDEK(boxID, p, current, dek)
		if readErr != nil {
			return readErr
		}
		if !bytes.Equal(plain, originalJSON) {
			return util.ErrFileChanged
		}
		return nil
	})
	if err != nil {
		logging.LogErrorf("write data [%s] failed: %s", filePath, err)
	}
	return
}

func parseJSON2Tree(boxID, p string, jsonData []byte, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	mode, err := DocumentAddressingMode(boxID)
	if err != nil {
		return nil, err
	}
	return parseJSON2TreeInMode(boxID, p, jsonData, luteEngine, mode)
}

func parseJSON2TreeInMode(boxID, p string, jsonData []byte, luteEngine *lute.Lute, mode int) (ret *parse.Tree, err error) {
	jsonData = bytes.TrimPrefix(jsonData, []byte("\xef\xbb\xbf"))
	if err = treenode.CheckSpecJSON(jsonData); nil != err {
		return
	}
	ret, _, err = dataparser.ParseJSON(jsonData, luteEngine.ParseOptions)
	if err != nil {
		logging.LogErrorf("parse json [%s] to tree failed: %s", boxID+p, err)
		err = fmt.Errorf("parse json [%s] to tree failed: %w", boxID+p, err)
		return
	}

	ret.Box = boxID
	ret.Path = p

	if err = treenode.CheckSpec(ret); nil != err {
		return
	}
	err = treenode.RefreshTableCellRichProjection(ret.Root)
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
