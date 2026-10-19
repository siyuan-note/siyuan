package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// MergeConfJSON 按精确键名递归合并对象，数组和 null 整体替换，未知字段由入站契约决定是否接受。
func MergeConfJSON(base, patch []byte) ([]byte, error) {
	return mergeConfJSON(base, patch, nil)
}

func mergeConfJSON(base, patch []byte, valueType reflect.Type) ([]byte, error) {
	var current, changes map[string]json.RawMessage
	if err := json.Unmarshal(base, &current); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(patch, &changes); err != nil {
		return nil, err
	}
	if current == nil {
		current = map[string]json.RawMessage{}
	}
	keys := make([]string, 0, len(changes))
	for key := range changes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := changes[key]
		target, fieldType := mergeConfJSONField(valueType, key)
		if bytes.HasPrefix(bytes.TrimSpace(value), []byte("{")) && bytes.HasPrefix(bytes.TrimSpace(current[target]), []byte("{")) {
			merged, err := mergeConfJSON(current[target], value, fieldType)
			if err != nil {
				return nil, err
			}
			current[target] = merged
		} else {
			current[target] = value
		}
	}
	return json.Marshal(current)
}

// mergeConfJSONField 按结构体声明匹配字段名，字典键保持精确匹配，并继续解析字典值的类型。
func mergeConfJSONField(valueType reflect.Type, key string) (string, reflect.Type) {
	for valueType != nil && valueType.Kind() == reflect.Pointer {
		valueType = valueType.Elem()
	}
	if valueType == nil {
		return key, nil
	}
	if valueType.Kind() == reflect.Map {
		return key, valueType.Elem()
	}
	if valueType.Kind() != reflect.Struct {
		return key, nil
	}
	name := key
	var fieldType reflect.Type
	for i := 0; i < valueType.NumField(); i++ {
		field := valueType.Field(i)
		if field.PkgPath != "" {
			continue
		}
		fieldName := strings.Split(field.Tag.Get("json"), ",")[0]
		if fieldName == "-" {
			continue
		}
		if fieldName == "" {
			fieldName = field.Name
		}
		if fieldName == key {
			return fieldName, field.Type
		}
		if fieldType == nil && strings.EqualFold(fieldName, key) {
			name, fieldType = fieldName, field.Type
		}
	}
	return name, fieldType
}

func (spec *SectionSpec[C]) patch(patch []byte) ([]Issue, error) {
	spec.WriteLock.Lock()
	defer spec.WriteLock.Unlock()
	for {
		old := spec.Load()
		next, err := mergeConfSection(old, patch)
		if err != nil {
			return nil, err
		}
		issues, err := applySectionLockedAt(spec, next, old, true)
		if errors.Is(err, errConfSectionChanged) {
			continue
		}
		return issues, err
	}
}

func mergeConfSection[C any](current C, patch []byte) (next C, err error) {
	data, err := MergeConfSectionJSON(current, patch)
	if err != nil {
		return next, err
	}
	err = json.Unmarshal(data, &next)
	return
}

// MergeConfSectionJSON 基于当前配置段合并补丁，供模型更新和入站契约校验共用。
func MergeConfSectionJSON(current any, patch []byte) ([]byte, error) {
	data, err := json.Marshal(current)
	if err != nil {
		return nil, err
	}
	return mergeConfJSON(data, patch, reflect.TypeOf(current))
}

// ConfSectionPatchJSON 返回合并后的配置段，调用方在发布前保留契约校验与专用领域动作。
func ConfSectionPatchJSON(namespace string, patch []byte) ([]byte, error) {
	if nil == Conf {
		return patch, nil
	}
	spec, ok := SectionSpecByNamespace(namespace)
	if !ok {
		return nil, fmt.Errorf("unsupported configuration section: %s", namespace)
	}
	return MergeConfSectionJSON(spec.load(), patch)
}

func ApplyConfPatch(namespace string, patch []byte) ([]Issue, error) {
	spec, ok := SectionSpecByNamespace(namespace)
	if !ok {
		return nil, fmt.Errorf("unsupported configuration section: %s", namespace)
	}
	return spec.patch(patch)
}

// ApplySyncSettingPatch 在来源锁与段写锁内合并，先验证全部改动，再一次性发布配置。
func ApplySyncSettingPatch(patch []byte) ([]Issue, error) {
	release := lockAssetSourceChange()
	defer release()
	spec := syncSectionSpec()
	old := spec.Load()
	next, err := mergeConfSection(old, patch)
	if err != nil {
		return nil, err
	}
	var requested map[string]json.RawMessage
	if err = json.Unmarshal(patch, &requested); err != nil {
		return nil, err
	}
	if next.Provider != old.Provider {
		return nil, errors.New("use setSyncProvider to change the sync provider")
	}
	if util.ContainerDocker == util.Container {
		next.Perception = false
	}
	if _, present := requested["s3"]; present || !reflect.DeepEqual(old.S3, next.S3) {
		if err = validateSyncS3(next.S3); err != nil {
			return nil, err
		}
	}
	if _, present := requested["webdav"]; present || !reflect.DeepEqual(old.WebDAV, next.WebDAV) {
		if err = validateSyncWebDAV(next.WebDAV); err != nil {
			return nil, err
		}
		if strings.Contains(strings.ToLower(next.WebDAV.Endpoint), "dav.jianguoyun.com") {
			return nil, errors.New(Conf.Language(194))
		}
	}
	if _, present := requested["local"]; present || !reflect.DeepEqual(old.Local, next.Local) {
		if err = validateSyncLocalPath(next.Local); err != nil {
			return nil, err
		}
	}
	if old.CloudName != next.CloudName {
		if old.Provider == conf.ProviderS3 {
			return nil, errors.New(Conf.Language(131))
		}
		if !cloud.IsValidCloudDirName(next.CloudName) {
			return nil, errors.New(Conf.Language(37))
		}
	}
	if next.AssetDownloadMode != 0 && next.AssetDownloadMode != 1 {
		return nil, errors.New("invalid asset download mode")
	}
	if old.AssetDownloadMode != next.AssetDownloadMode && next.AssetDownloadMode == 0 {
		if err = ensureCompleteSyncAssets(nil); err != nil {
			return nil, err
		}
	}
	next = conf.NormalizeSync(next)
	if old.LAN != nil && old.LAN.Enabled && !next.LAN.Enabled {
		next.Stat = removeLANSyncTrafficStat(next.Stat)
	}
	sourceChanged := old.CloudName != next.CloudName ||
		(old.Provider == conf.ProviderS3 && (next.S3.Endpoint != old.S3.Endpoint || next.S3.Bucket != old.S3.Bucket)) ||
		(old.Provider == conf.ProviderWebDAV && (next.WebDAV.Endpoint != old.WebDAV.Endpoint || next.WebDAV.Username != old.WebDAV.Username)) ||
		(old.Provider == conf.ProviderLocal && filepath.Clean(next.Local.Endpoint) != filepath.Clean(old.Local.Endpoint))
	if sourceChanged {
		if err = requireCompleteAssetDownloads(); err != nil {
			return nil, err
		}
	}
	// 来源检查可能更新同步运行状态，完成后再取得段写锁并以最新快照重新合并。
	spec.WriteLock.Lock()
	defer spec.WriteLock.Unlock()
	old = spec.Load()
	next, err = mergeConfSection(old, patch)
	if err != nil {
		return nil, err
	}
	if util.ContainerDocker == util.Container {
		next.Perception = false
	}
	next = conf.NormalizeSync(next)
	if old.LAN != nil && old.LAN.Enabled && !next.LAN.Enabled {
		next.Stat = removeLANSyncTrafficStat(next.Stat)
	}
	issues, err := applySectionLocked(spec, next)
	if err != nil {
		return issues, err
	}
	next = spec.Load()
	refreshLANSyncManager()
	if old.Interval != next.Interval {
		planSyncAfter(time.Duration(next.Interval) * time.Second)
	}
	if old.Perception != next.Perception {
		if next.Perception {
			connectSyncWebSocket()
		} else {
			closeSyncWebSocket()
		}
	}
	return issues, nil
}

func validateSyncLocalPath(local *conf.Local) error {
	if err := validateSyncLocal(local); err != nil {
		return err
	}
	absPath, err := filepath.Abs(util.NormalizeLocalPath(local.Endpoint))
	if err != nil {
		return fmt.Errorf(Conf.Language(77), err.Error())
	}
	if !gulu.File.IsExist(absPath) {
		return fmt.Errorf(Conf.Language(77), fmt.Sprintf("endpoint [%s] not exist", local.Endpoint))
	}
	if util.IsAbsPathInWorkspace(absPath) || filepath.Clean(absPath) == filepath.Clean(util.WorkspaceDir) || gulu.File.IsSubPath(absPath, util.WorkspaceDir) {
		return fmt.Errorf(Conf.Language(77), fmt.Sprintf("endpoint [%s] overlaps workspace", local.Endpoint))
	}
	return nil
}
