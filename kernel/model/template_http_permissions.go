// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const templateHTTPPermissionsFile = "template-http-permissions.json"
const templateHTTPPermissionLimit = 4096
const templateHTTPPermissionBytes = 2 << 20

var errTemplateHTTPSourceStale = errors.New("template network permission source is no longer current")

// TemplateHTTPSource 只由内核读取的源码生成，界面不能提交来源身份来创建许可。
type TemplateHTTPSource struct {
	ID, Version, Kind, Label   string
	Persistable                bool
	locator, proof, filename   string
	owner, avID, fieldID, slot string
}

type TemplateHTTPPermission struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Label   string `json:"label"`
	Granted bool   `json:"granted"`
}

type templateHTTPPermissionRecord struct {
	ID          string `json:"id"`
	Version     string `json:"sourceVersion"`
	Kind        string `json:"kind"`
	Label       string `json:"label"`
	File        string `json:"file,omitempty"`
	Owner       string `json:"owner,omitempty"`
	AV          string `json:"av,omitempty"`
	Field       string `json:"field,omitempty"`
	Slot        string `json:"slot,omitempty"`
	Granted     bool   `json:"granted"`
	Persistable bool   `json:"persistable"`
}

type templateHTTPPermissionState struct {
	Version int                                     `json:"version"`
	Sources map[string]templateHTTPPermissionRecord `json:"sources"`
}

var templateHTTPPermissionStore = struct {
	sync.Mutex
	path  string
	state templateHTTPPermissionState
	err   error
	dirty bool
}{}

// TemplateHTTPSourceRevoked 在许可锁外通知执行管理器，避免锁顺序反转。
var TemplateHTTPSourceRevoked func(sourceIDs []string)

func templateHTTPDigest(parts ...string) string {
	data, _ := json.Marshal(parts)
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func loadTemplateHTTPPermissionsLocked() error {
	if util.ConfDir == "" {
		return errors.New("template network permission storage is unavailable")
	}
	filename := filepath.Join(util.ConfDir, templateHTTPPermissionsFile)
	if templateHTTPPermissionStore.path == filename {
		return templateHTTPPermissionStore.err
	}
	templateHTTPPermissionStore.path = filename
	templateHTTPPermissionStore.state = templateHTTPPermissionState{Version: 1, Sources: map[string]templateHTTPPermissionRecord{}}
	templateHTTPPermissionStore.err = nil
	templateHTTPPermissionStore.dirty = false
	file, err := util.OpenPublishFile(util.ConfDir, templateHTTPPermissionsFile)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		templateHTTPPermissionStore.err = err
		return err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, templateHTTPPermissionBytes+1))
	var state templateHTTPPermissionState
	if err == nil && (len(data) > templateHTTPPermissionBytes || json.Unmarshal(data, &state) != nil || state.Version != 1 || state.Sources == nil || len(state.Sources) > templateHTTPPermissionLimit) {
		err = errors.New("invalid template network permission storage")
	}
	if err == nil {
		for locator, entry := range state.Sources {
			if len(locator) != 64 || len(entry.ID) < 16 || len(entry.Version) != 64 || !entry.Granted || !entry.Persistable || (entry.Kind != "file" && entry.Kind != "database") {
				err = errors.New("invalid template network permission storage")
				break
			}
		}
	}
	if err == nil {
		templateHTTPPermissionStore.state = state
	}
	templateHTTPPermissionStore.err = err
	return err
}

func saveTemplateHTTPPermissionsLocked() error {
	templateHTTPPermissionStore.dirty = true
	state := templateHTTPPermissionState{Version: 1, Sources: map[string]templateHTTPPermissionRecord{}}
	for locator, record := range templateHTTPPermissionStore.state.Sources {
		if record.Granted && record.Persistable {
			state.Sources[locator] = record
		}
	}
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if len(data) > templateHTTPPermissionBytes {
		return errors.New("too many template network permissions")
	}
	if err = os.MkdirAll(util.ConfDir, 0700); err != nil {
		return err
	}
	err = gulu.File.WriteFileSafer(templateHTTPPermissionStore.path, data, 0600)
	if err == nil {
		templateHTTPPermissionStore.dirty = false
	}
	return err
}

func notifyTemplateHTTPSourcesRevoked(ids []string) {
	if len(ids) > 0 && TemplateHTTPSourceRevoked != nil {
		TemplateHTTPSourceRevoked(ids)
	}
}

func resolveTemplateHTTPSource(locator string, record templateHTTPPermissionRecord, proof, filename string) (*TemplateHTTPSource, error) {
	var revoked []string
	templateHTTPPermissionStore.Lock()
	defer func() { templateHTTPPermissionStore.Unlock(); notifyTemplateHTTPSourcesRevoked(revoked) }()
	if err := loadTemplateHTTPPermissionsLocked(); err != nil {
		return nil, err
	}
	existing, exists := templateHTTPPermissionStore.state.Sources[locator]
	if exists && existing.Version == record.Version && existing.Persistable == record.Persistable {
		record = existing
	} else {
		if exists {
			revoked = append(revoked, existing.ID)
		} else if len(templateHTTPPermissionStore.state.Sources) >= templateHTTPPermissionLimit {
			for key, candidate := range templateHTTPPermissionStore.state.Sources {
				if !candidate.Granted {
					delete(templateHTTPPermissionStore.state.Sources, key)
					revoked = append(revoked, candidate.ID)
					break
				}
			}
			if len(templateHTTPPermissionStore.state.Sources) >= templateHTTPPermissionLimit {
				return nil, errors.New("too many template permission sources")
			}
		}
		record.ID = rand.Text()
		templateHTTPPermissionStore.state.Sources[locator] = record
		if existing.Granted {
			if err := saveTemplateHTTPPermissionsLocked(); err != nil {
				return nil, err
			}
		}
	}
	return &TemplateHTTPSource{ID: record.ID, Version: record.Version, Kind: record.Kind, Label: record.Label,
		Persistable: record.Persistable, locator: locator, proof: proof, filename: filename,
		owner: record.Owner, avID: record.AV, fieldID: record.Field, slot: record.Slot}, nil
}

// ReadTemplateHTTPFile 的身份、摘要和执行内容来自同一次受限文件读取。
func ReadTemplateHTTPFile(filename string) ([]byte, *TemplateHTTPSource, error) {
	relative, err := filepath.Rel(filepath.Join(util.DataDir, "templates"), filepath.Clean(filename))
	if err != nil {
		return nil, nil, err
	}
	relative = filepath.ToSlash(relative)
	root, err := openTemplateRoot()
	if err != nil {
		return nil, nil, err
	}
	defer root.Close()
	if err = checkTemplateFilePath(root, relative); err != nil {
		return nil, nil, err
	}
	file, err := root.Open(relative)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()
	before, err := file.Stat()
	if err != nil || !before.Mode().IsRegular() || before.Size() > maxTemplateSourceSize {
		return nil, nil, errors.New("invalid template source file")
	}
	proof, persistable, err := templateHTTPSourceFileProof(file)
	if err != nil {
		return nil, nil, err
	}
	data, err := io.ReadAll(io.LimitReader(file, maxTemplateSourceSize+1))
	if err != nil {
		return nil, nil, err
	}
	after, err := file.Stat()
	secondProof, _, proofErr := templateHTTPSourceFileProof(file)
	if err != nil || proofErr != nil || len(data) > maxTemplateSourceSize || !os.SameFile(before, after) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) || proof != secondProof || int64(len(data)) != after.Size() {
		return nil, nil, errors.New("template changed while reading")
	}
	digest := sha256.Sum256(data)
	version := templateHTTPDigest(hex.EncodeToString(digest[:]), proof)
	source, err := resolveTemplateHTTPSource(templateHTTPDigest("file", relative), templateHTTPPermissionRecord{
		Version: version, Kind: "file", Label: relative, File: relative, Persistable: persistable,
	}, proof, filepath.Join(root.Name(), filepath.FromSlash(relative)))
	return data, source, err
}

// ResolveTemplateHTTPInlineSource 只有与内核读取的当前磁盘内容一致时才能建立持久许可。
func ResolveTemplateHTTPInlineSource(filename string, data []byte) (*TemplateHTTPSource, error) {
	disk, source, err := ReadTemplateHTTPFile(filename)
	if err == nil && sha256.Sum256(disk) == sha256.Sum256(data) {
		return source, nil
	}
	digest := sha256.Sum256(data)
	return resolveTemplateHTTPSource(templateHTTPDigest("inline", filename, hex.EncodeToString(digest[:])), templateHTTPPermissionRecord{
		Version: templateHTTPDigest("inline", hex.EncodeToString(digest[:])), Kind: "inline", Label: filepath.Base(filename),
	}, "", "")
}

// ResolveTemplateHTTPDBSource 普通数据库属于全局存储，加密数据库使用真实笔记本 ID。
func ResolveTemplateHTTPDBSource(owner, avID, fieldID, slot, content string) (*TemplateHTTPSource, error) {
	if owner == "" {
		owner = "global"
	}
	if avID == "" || fieldID == "" || (slot != "template" && slot != "renderTemplate") {
		return nil, errors.New("invalid template permission source")
	}
	return resolveTemplateHTTPSource(templateHTTPDigest("database", owner, avID, fieldID, slot), templateHTTPPermissionRecord{
		Version: templateHTTPDigest(content), Kind: "database", Label: avID + "/" + fieldID,
		Owner: owner, AV: avID, Field: fieldID, Slot: slot, Persistable: true,
	}, "", "")
}

func templateHTTPSourceMatchesLocked(source *TemplateHTTPSource) (templateHTTPPermissionRecord, bool) {
	if source == nil {
		return templateHTTPPermissionRecord{}, false
	}
	record, exists := templateHTTPPermissionStore.state.Sources[source.locator]
	return record, exists && record.ID == source.ID && record.Version == source.Version
}

func templateHTTPSourceFileProof(file *os.File) (string, bool, error) {
	proof, persistable, err := templateHTTPFileProof(file)
	if err != nil || persistable {
		return proof, persistable, err
	}
	info, err := file.Stat()
	if err != nil {
		return "", false, err
	}
	return fmt.Sprintf("unsupported:%d:%d", info.Size(), info.ModTime().UnixNano()), false, nil
}

func IsTemplateHTTPSourceCurrent(source *TemplateHTTPSource) bool {
	if source == nil {
		return false
	}
	if source.Kind == "database" && !templateHTTPDatabaseSourceCurrent(source) {
		return false
	}
	if source.filename != "" {
		file, err := os.Open(source.filename)
		if err != nil {
			return false
		}
		proof, _, err := templateHTTPSourceFileProof(file)
		file.Close()
		if err != nil || proof != source.proof {
			return false
		}
	}
	templateHTTPPermissionStore.Lock()
	defer templateHTTPPermissionStore.Unlock()
	if loadTemplateHTTPPermissionsLocked() != nil {
		return false
	}
	_, valid := templateHTTPSourceMatchesLocked(source)
	return valid
}

// 直接读取当前持久化字段，不使用渲染结果或 AV 读缓存，覆盖同步及外部写入后的旧确认。
func templateHTTPDatabaseSourceCurrent(source *TemplateHTTPSource) bool {
	owner := source.owner
	if owner == "global" {
		owner = ""
		if av.GetAVBoxID(source.avID) != "" {
			return false
		}
	}
	data, err := av.ReadAttributeViewDataInBox(source.avID, owner)
	if err != nil || len(data) == 0 {
		return false
	}
	defer clear(data)
	fields, valid := templateHTTPCheckoutFields(data, source.avID)
	if !valid {
		return false
	}
	field, exists := fields[source.fieldID]
	if !exists {
		return false
	}
	content := field.RenderTemplate
	if source.slot == "template" {
		if field.Type != string(av.KeyTypeTemplate) {
			return false
		}
		content = field.Template
	} else if field.Type == string(av.KeyTypeTemplate) {
		return false
	}
	return templateHTTPDigest(content) == source.Version
}

func CheckTemplateHTTPSource(source *TemplateHTTPSource) (bool, error) {
	if !IsTemplateHTTPSourceCurrent(source) {
		return false, errTemplateHTTPSourceStale
	}
	templateHTTPPermissionStore.Lock()
	defer templateHTTPPermissionStore.Unlock()
	record, valid := templateHTTPSourceMatchesLocked(source)
	if !valid {
		return false, errTemplateHTTPSourceStale
	}
	return record.Granted && record.Persistable, nil
}

func GrantTemplateHTTPSource(source *TemplateHTTPSource) error {
	if !IsTemplateHTTPSourceCurrent(source) {
		return errTemplateHTTPSourceStale
	}
	templateHTTPPermissionStore.Lock()
	defer templateHTTPPermissionStore.Unlock()
	record, valid := templateHTTPSourceMatchesLocked(source)
	if !valid {
		return errTemplateHTTPSourceStale
	}
	if !record.Persistable {
		return errors.New("template source cannot retain network permission")
	}
	record.Granted = true
	templateHTTPPermissionStore.state.Sources[source.locator] = record
	if err := saveTemplateHTTPPermissionsLocked(); err != nil {
		record.Granted = false
		templateHTTPPermissionStore.state.Sources[source.locator] = record
		return err
	}
	return nil
}

func ListTemplateHTTPPermissions() ([]TemplateHTTPPermission, error) {
	templateHTTPPermissionStore.Lock()
	defer templateHTTPPermissionStore.Unlock()
	if err := loadTemplateHTTPPermissionsLocked(); err != nil {
		return nil, err
	}
	ret := []TemplateHTTPPermission{}
	for _, record := range templateHTTPPermissionStore.state.Sources {
		if record.Granted {
			ret = append(ret, TemplateHTTPPermission{ID: record.ID, Kind: record.Kind, Label: record.Label, Granted: true})
		}
	}
	sort.Slice(ret, func(i, j int) bool { return ret[i].ID < ret[j].ID })
	return ret, nil
}

func invalidateTemplateHTTPSources(match func(templateHTTPPermissionRecord) bool) error {
	if util.ConfDir == "" {
		return nil
	}
	var revoked []string
	templateHTTPPermissionStore.Lock()
	defer func() { templateHTTPPermissionStore.Unlock(); notifyTemplateHTTPSourcesRevoked(revoked) }()
	if err := loadTemplateHTTPPermissionsLocked(); err != nil {
		return err
	}
	changed := false
	for locator, record := range templateHTTPPermissionStore.state.Sources {
		if match(record) {
			revoked = append(revoked, record.ID)
			changed = changed || record.Granted
			delete(templateHTTPPermissionStore.state.Sources, locator)
		}
	}
	if changed || templateHTTPPermissionStore.dirty {
		return saveTemplateHTTPPermissionsLocked()
	}
	return nil
}

func RevokeTemplateHTTPSource(id string) error {
	return invalidateTemplateHTTPSources(func(record templateHTTPPermissionRecord) bool { return record.ID == id })
}

func RevokeAllTemplateHTTPPermissions() error {
	return invalidateTemplateHTTPSources(func(templateHTTPPermissionRecord) bool { return true })
}

func InvalidateTemplateHTTPFilePath(filename string) error {
	relative, err := filepath.Rel(filepath.Join(util.DataDir, "templates"), filepath.Clean(filename))
	if err != nil {
		return err
	}
	relative = filepath.ToSlash(relative)
	if relative == ".." || strings.HasPrefix(relative, "../") {
		return errors.New("invalid template source path")
	}
	return invalidateTemplateHTTPSources(func(record templateHTTPPermissionRecord) bool {
		return record.Kind == "file" && (relative == "." || record.File == relative || strings.HasPrefix(record.File, relative+"/"))
	})
}

func InvalidateTemplateHTTPDatabase(owner, avID, fieldID string) error {
	if owner == "" {
		owner = "global"
	}
	return invalidateTemplateHTTPSources(func(record templateHTTPPermissionRecord) bool {
		return record.Kind == "database" && record.Owner == owner && record.AV == avID && (fieldID == "" || record.Field == fieldID)
	})
}

func GetTemplateHTTPFilePermission(relativePath string) (bool, error) {
	if util.ConfDir == "" {
		return false, nil
	}
	if err := validateTemplateRelativePath(relativePath, false); err != nil {
		return false, err
	}
	templateHTTPPermissionStore.Lock()
	if err := loadTemplateHTTPPermissionsLocked(); err != nil {
		templateHTTPPermissionStore.Unlock()
		return false, err
	}
	record, exists := templateHTTPPermissionStore.state.Sources[templateHTTPDigest("file", relativePath)]
	templateHTTPPermissionStore.Unlock()
	if !exists || !record.Granted {
		return false, nil
	}
	_, source, err := ReadTemplateHTTPFile(filepath.Join(util.DataDir, "templates", filepath.FromSlash(relativePath)))
	if err != nil {
		return false, err
	}
	return CheckTemplateHTTPSource(source)
}
