package memo

import (
	"context"
	"encoding/hex"
	"errors"
	"os"
	"slices"
	"sort"
)

type operationManifest struct {
	Schema            int      `yaml:"schema"`
	ID                string   `yaml:"id"`
	SourceFingerprint string   `yaml:"sourceFingerprint"`
	ActionKeys        []string `yaml:"actionKeys"`
}

func validHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, e := hex.DecodeString(value)
	return e == nil
}

// PrepareOperation 持久保存无正文的批次身份，重试不得换用另一组模型建议。
func (s *Store) PrepareOperation(ctx context.Context, operationID, sourceFingerprint string, actionKeys []string) error {
	if operationID == "" || len(operationID) > 256 || !validHash(sourceFingerprint) || len(actionKeys) > 200 {
		return ErrInvalid
	}
	keys := append([]string{}, actionKeys...)
	sort.Strings(keys)
	for i, key := range keys {
		if !validHash(key) || (i > 0 && keys[i-1] == key) {
			return ErrInvalid
		}
	}
	manifest := operationManifest{Schema: 1, ID: revision([]byte(operationID)), SourceFingerprint: sourceFingerprint, ActionKeys: keys}
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := checkContext(ctx); e != nil {
		return e
	}
	root, e := s.root(true)
	if e != nil {
		return e
	}
	defer root.Close()
	or, e := subroot(root, "operations", true)
	if e != nil {
		return e
	}
	defer or.Close()
	name := manifest.ID + ".md"
	data, e := readFile(or, name)
	if e == nil {
		var old operationManifest
		body, e := decode(data, &old)
		if e != nil || body != "" || old.Schema != 1 || old.ID != manifest.ID {
			return ErrInvalid
		}
		if old.SourceFingerprint != manifest.SourceFingerprint || !slices.Equal(old.ActionKeys, keys) {
			return ErrConflict
		}
		return nil
	}
	if !errors.Is(e, os.ErrNotExist) {
		return e
	}
	data, e = encode(manifest, "")
	if e != nil {
		return e
	}
	if e = checkContext(ctx); e != nil {
		return e
	}
	return writeFile(or, name, data)
}
