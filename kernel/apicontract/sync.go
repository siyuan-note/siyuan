package apicontract

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"strings"
)

type SyncEnabledRequest struct {
	Enabled bool `json:"enabled"`
}
type SyncIntervalRequest struct {
	Interval float64 `json:"interval"`
}
type SyncModeRequest struct {
	Mode float64 `json:"mode"`
}
type SyncProviderRequest struct {
	Provider float64 `json:"provider"`
	// 显式确认后补齐原来源的资源和历史快照，缺省时只检查完整性。
	CompleteAssets bool `json:"completeAssets" api:"optional,nullable"`
}
type SyncNameRequest struct {
	Name string `json:"name" api:"trim"`
}
type SyncLANRequest struct {
	Enabled           bool    `json:"enabled"`
	MaxConcurrentReqs float64 `json:"maxConcurrentReqs" api:"optional,nullable"`
}
type PerformSyncRequest struct {
	MobileSwitch bool `json:"mobileSwitch" api:"optional,nullable"`
	Upload       bool `json:"upload" api:"optional"`
	uploadFields map[string]json.RawMessage
}

// UploadDirection 在完全手动模式下校验同步方向，其他模式不读取此字段。
func (r PerformSyncRequest) UploadDirection() (bool, error) {
	return legacyField[bool](r.uploadFields, "upload", "Boolean", true)
}

type SyncProviderImportRequest struct {
	File *multipart.FileHeader `json:"file" api:"optional"`
}
type SyncProviderExportData struct {
	Name string `json:"name"`
	Zip  string `json:"zip"`
}
type SyncS3 struct {
	Endpoint       string `json:"endpoint" api:"optional,nullable"`
	AccessKey      string `json:"accessKey" api:"optional,nullable"`
	SecretKey      string `json:"secretKey" api:"optional,nullable"`
	Bucket         string `json:"bucket" api:"optional,nullable"`
	Region         string `json:"region" api:"optional,nullable"`
	PathStyle      bool   `json:"pathStyle" api:"optional,nullable"`
	SkipTlsVerify  bool   `json:"skipTlsVerify" api:"optional,nullable"`
	Timeout        int    `json:"timeout" api:"optional,nullable"`
	ConcurrentReqs int    `json:"concurrentReqs" api:"optional,nullable"`
}
type SyncWebDAV struct {
	Endpoint       string `json:"endpoint" api:"optional,nullable"`
	Username       string `json:"username" api:"optional,nullable"`
	Password       string `json:"password" api:"optional,nullable"`
	SkipTlsVerify  bool   `json:"skipTlsVerify" api:"optional,nullable"`
	Timeout        int    `json:"timeout" api:"optional,nullable"`
	ConcurrentReqs int    `json:"concurrentReqs" api:"optional,nullable"`
}
type SyncLocal struct {
	Endpoint       string `json:"endpoint" api:"optional,nullable"`
	Timeout        int    `json:"timeout" api:"optional,nullable"`
	ConcurrentReqs int    `json:"concurrentReqs" api:"optional,nullable"`
}
type SyncS3Data struct {
	S3 *SyncS3 `json:"s3"`
}
type SyncWebDAVData struct {
	WebDAV *SyncWebDAV `json:"webdav"`
}
type SyncLocalData struct {
	Local *SyncLocal `json:"local"`
}
type SetSyncS3Request struct {
	S3          SyncS3 `json:"s3"`
	configError error
}
type SetSyncWebDAVRequest struct {
	WebDAV      SyncWebDAV `json:"webdav"`
	configError error
}
type SetSyncLocalRequest struct {
	Local       SyncLocal `json:"local"`
	configError error
}

func (r SetSyncS3Request) ConfigError() error     { return r.configError }
func (r SetSyncWebDAVRequest) ConfigError() error { return r.configError }
func (r SetSyncLocalRequest) ConfigError() error  { return r.configError }

type SyncLANStatus struct {
	Enabled           bool `json:"enabled"`
	Active            bool `json:"active"`
	DiscoveredPeers   int  `json:"discoveredPeers"`
	ConnectedPeers    int  `json:"connectedPeers"`
	MaxConcurrentReqs int  `json:"maxConcurrentReqs"`
}
type SyncOnlineKernel struct {
	ID       string `json:"id"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Ver      string `json:"ver"`
}
type SyncInfoData struct {
	Synced  int64               `json:"synced"`
	Stat    string              `json:"stat"`
	Kernels []*SyncOnlineKernel `json:"kernels"`
	Kernel  string              `json:"kernel"`
}
type CloudSyncDir struct {
	Size      int64  `json:"size"`
	HSize     string `json:"hSize"`
	Updated   string `json:"updated"`
	CloudName string `json:"cloudName"`
	SaveDir   string `json:"saveDir"`
}
type CloudSyncDirsData struct {
	SyncDirs       []*CloudSyncDir `json:"syncDirs"`
	HSize          string          `json:"hSize"`
	CheckedSyncDir string          `json:"checkedSyncDir"`
}
type SyncAssetDownloadModeData struct {
	AssetDownloadMode int `json:"assetDownloadMode"`
}

func syncConfigError(err error, name string) error {
	if err == nil {
		return nil
	}
	detail := strings.ReplaceAll(err.Error(), "apicontract.Sync"+name, "conf."+name)
	return errors.New(strings.ReplaceAll(detail, "struct field Sync"+name+".", "struct field "+name+"."))
}

// syncRequestFields 保留整份请求的 JSON 数字解析、重复字段和首个对象读取语义。
func syncRequestFields(reader io.Reader, path string) (fields map[string]json.RawMessage, err error) {
	var raw json.RawMessage
	err = json.NewDecoder(reader).Decode(&raw)
	if err == nil {
		fields, err = legacyJSONValue[map[string]json.RawMessage](raw)
	}
	if err != nil {
		if errors.Is(err, io.EOF) {
			err = errors.New("the request body is empty or truncated (EOF)")
		}
		detail := strings.ReplaceAll(err.Error(), "map[string]json.RawMessage", "map[string]interface {}")
		err = fmt.Errorf("Parses request [%s] failed: %s", path, detail)
	}
	return
}

func init() {
	for _, endpoint := range []*Endpoint[SyncEnabledRequest, Null]{&SetSyncEnable, &SetSyncPerception, &SetSyncGenerateConflictDoc} {
		path := endpoint.definition.Path
		endpoint.decodeRequest = func(reader io.Reader) (r SyncEnabledRequest, err error) {
			fields, err := syncRequestFields(reader, path)
			if err == nil {
				r.Enabled, err = legacyField[bool](fields, "enabled", "Boolean", true)
			}
			return r, err
		}
	}
	SetSyncInterval.decodeRequest = func(reader io.Reader) (r SyncIntervalRequest, err error) {
		fields, err := syncRequestFields(reader, SetSyncInterval.definition.Path)
		if err == nil {
			r.Interval, err = legacyField[float64](fields, "interval", "Number", true)
		}
		return r, err
	}
	decodeMode := func(path string) func(io.Reader) (SyncModeRequest, error) {
		return func(reader io.Reader) (r SyncModeRequest, err error) {
			fields, err := syncRequestFields(reader, path)
			if err == nil {
				r.Mode, err = legacyField[float64](fields, "mode", "Number", true)
			}
			return r, err
		}
	}
	SetSyncMode.decodeRequest = decodeMode(SetSyncMode.definition.Path)
	SetSyncAssetDownloadMode.decodeRequest = decodeMode(SetSyncAssetDownloadMode.definition.Path)
	SetSyncProvider.decodeRequest = func(reader io.Reader) (r SyncProviderRequest, err error) {
		fields, err := syncRequestFields(reader, SetSyncProvider.definition.Path)
		if err == nil {
			r.Provider, err = legacyField[float64](fields, "provider", "Number", true)
		}
		if err == nil {
			r.CompleteAssets, err = legacyField[bool](fields, "completeAssets", "Boolean", false)
		}
		return r, err
	}
	decodeName := func(path string) func(io.Reader) (SyncNameRequest, error) {
		return func(reader io.Reader) (r SyncNameRequest, err error) {
			fields, err := syncRequestFields(reader, path)
			if err == nil {
				r.Name, err = legacyField[string](fields, "name", "String", true)
			}
			if err == nil {
				r.Name = strings.TrimSpace(r.Name)
				if r.Name == "" {
					err = errors.New("Field [name] must not be empty")
				}
			}
			return r, err
		}
	}
	SetCloudSyncDir.decodeRequest = decodeName(SetCloudSyncDir.definition.Path)
	CreateCloudSyncDir.decodeRequest = decodeName(CreateCloudSyncDir.definition.Path)
	RemoveCloudSyncDir.decodeRequest = decodeName(RemoveCloudSyncDir.definition.Path)
	SetSyncLAN.decodeRequest = func(reader io.Reader) (r SyncLANRequest, err error) {
		fields, err := syncRequestFields(reader, SetSyncLAN.definition.Path)
		if err != nil {
			return r, err
		}
		if r.Enabled, err = legacyField[bool](fields, "enabled", "Boolean", true); err != nil {
			return r, err
		}
		r.MaxConcurrentReqs, err = legacyField[float64](fields, "maxConcurrentReqs", "Number", false)
		return r, err
	}
	PerformSync.decodeRequest = func(reader io.Reader) (r PerformSyncRequest, err error) {
		r.uploadFields, err = syncRequestFields(reader, PerformSync.definition.Path)
		if err == nil {
			r.MobileSwitch, err = legacyField[bool](r.uploadFields, "mobileSwitch", "Boolean", false)
		}
		return r, err
	}
	SetSyncProviderS3.decodeRequest = func(reader io.Reader) (r SetSyncS3Request, err error) {
		fields, err := syncRequestFields(reader, SetSyncProviderS3.definition.Path)
		if err != nil {
			return r, err
		}
		if _, err = legacyField[map[string]json.RawMessage](fields, "s3", "Object", true); err != nil {
			return r, err
		}
		r.S3, r.configError = legacyJSONValue[SyncS3](fields["s3"])
		r.configError = syncConfigError(r.configError, "S3")
		return r, nil
	}
	SetSyncProviderWebDAV.decodeRequest = func(reader io.Reader) (r SetSyncWebDAVRequest, err error) {
		fields, err := syncRequestFields(reader, SetSyncProviderWebDAV.definition.Path)
		if err != nil {
			return r, err
		}
		if _, err = legacyField[map[string]json.RawMessage](fields, "webdav", "Object", true); err != nil {
			return r, err
		}
		r.WebDAV, r.configError = legacyJSONValue[SyncWebDAV](fields["webdav"])
		r.configError = syncConfigError(r.configError, "WebDAV")
		return r, nil
	}
	SetSyncProviderLocal.decodeRequest = func(reader io.Reader) (r SetSyncLocalRequest, err error) {
		fields, err := syncRequestFields(reader, SetSyncProviderLocal.definition.Path)
		if err != nil {
			return r, err
		}
		if _, err = legacyField[map[string]json.RawMessage](fields, "local", "Object", true); err != nil {
			return r, err
		}
		r.Local, r.configError = legacyJSONValue[SyncLocal](fields["local"])
		r.configError = syncConfigError(r.configError, "Local")
		return r, nil
	}
}
