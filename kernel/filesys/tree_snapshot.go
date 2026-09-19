package filesys

import (
	"crypto/sha256"
	"fmt"
	"path/filepath"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// ReadTreeSnapshot 认证磁盘内容并构造独立快照，不使用内容缓存，也不修复或写回源文件。
func ReadTreeSnapshot(boxID, p string) (*parse.Tree, [sha256.Size]byte, error) {
	var fingerprint [sha256.Size]byte
	if err := validateTreePath(boxID, p); err != nil {
		return nil, fingerprint, err
	}
	dek, _, release, err := acquireCryptoLease(boxID)
	if err != nil {
		return nil, fingerprint, err
	}
	defer release()
	data, err := filelock.ReadFile(filepath.Join(util.DataDir, boxID, p))
	if err != nil {
		return nil, fingerprint, err
	}
	fingerprint = sha256.Sum256(data)
	data, err = decryptDataWithDEK(boxID, p, data, dek)
	if err != nil {
		return nil, fingerprint, err
	}
	tree, err := parseJSON2Tree(boxID, p, data, util.NewLute())
	if err != nil {
		return nil, fingerprint, err
	}
	if tree.Root == nil || tree.Root.Type != ast.NodeDocument || tree.Root.ID != util.GetTreeID(p) {
		return nil, fingerprint, fmt.Errorf("invalid document root or mismatched ID [%s]", p)
	}
	if err = NormalizeTreeForRead(tree); err != nil {
		return nil, fingerprint, err
	}
	tree.HPath, _, err = ReadDocHPath(boxID, p)
	return tree, fingerprint, err
}
