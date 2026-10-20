package filesys

import (
	"path/filepath"
	"strings"

	"github.com/88250/lute"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// CachedTreeSource 保存普通文档缓存及父级标题的独立副本，解析不再访问文件或发布缓存。
type CachedTreeSource struct {
	data              []byte
	boxID, path       string
	parentHPathPrefix string
}

// CaptureCachedTreeSource 在调用方的读取边界内复制已缓存来源。
// 缓存缺失、加密来源和需要订正的父链返回 nil，由调用方完成完整加载。
func CaptureCachedTreeSource(boxID, p string) (*CachedTreeSource, error) {
	if err := validateTreePath(boxID, p); err != nil {
		return nil, err
	}
	_, encrypted, release, err := acquireCryptoLease(boxID)
	if err != nil {
		return nil, err
	}
	defer release()
	if encrypted {
		return nil, nil
	}
	data, ok := cache.GetTreeDataInBox(util.GetTreeID(p), boxID)
	if !ok {
		return nil, nil
	}
	if err = checkTreeFile(filepath.Join(util.DataDir, boxID, p)); err != nil {
		return nil, err
	}
	parts := strings.Split(strings.TrimPrefix(filepath.ToSlash(p), "/"), "/")
	var prefix strings.Builder
	prefix.WriteString("/")
	for i := 0; i < len(parts)-1; i++ {
		parentPath := filepath.Join(util.DataDir, boxID, strings.Join(parts[:i+1], "/")+".sy")
		properties, parentErr := readParentDocIAL(parentPath)
		if parentErr != nil {
			return nil, nil
		}
		title := properties["title"]
		if title == "" {
			title = "Untitled"
		}
		prefix.WriteString(title)
		prefix.WriteString("/")
	}
	return &CachedTreeSource{data: data, boxID: boxID, path: p, parentHPathPrefix: prefix.String()}, nil
}

// Parse 在调用方释放事务锁后构造独立树，保留捕获时的路径与父级标题。
func (source *CachedTreeSource) Parse(luteEngine *lute.Lute) (*parse.Tree, error) {
	tree, err := parseJSON2Tree(source.boxID, source.path, source.data, luteEngine)
	if err != nil {
		return nil, err
	}
	tree.Root.Path = source.path
	tree.HPath = source.parentHPathPrefix + tree.Root.IALAttr("title")
	tree.Hash = treenode.NodeHash(tree.Root, tree, luteEngine)
	return tree, nil
}
