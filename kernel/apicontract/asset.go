package apicontract

import (
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"reflect"
)

type AssetPathRequest struct {
	Path string `json:"path"`
}

type AssetOCRTextRequest struct {
	Path *string `json:"path" api:"optional"`
}

type SetAssetOCRTextRequest struct {
	Path string `json:"path"`
	Text string `json:"text"`
}

type RenameAssetRequest struct {
	OldPath string `json:"oldPath"`
	NewName string `json:"newName"`
}

type AssetDocumentRequest struct {
	ID string `json:"id"`
}

type AssetDocumentAssetsRequest struct {
	ID             string `json:"id"`
	RetainQueryStr *bool  `json:"retainQueryStr" api:"optional"`
}

type SetAssetAnnotationRequest struct {
	Path string `json:"path"`
	Data string `json:"data"`
}

type AssetCloudUploadRequest struct {
	IgnorePushMsg bool   `json:"ignorePushMsg" api:"optional,nullable"`
	ID            string `json:"id"`
}

type AssetPathsCloudUploadRequest struct {
	Paths         []string `json:"paths"`
	IgnorePushMsg bool     `json:"ignorePushMsg" api:"optional,nullable"`
}

type InsertLocalAssetsRequest struct {
	AssetPaths    []string `json:"assetPaths"`
	IsUpload      *bool    `json:"isUpload" api:"optional"`
	ID            string   `json:"id" api:"optional,nullable,ignoretype"`
	FromHTMLPaste bool     `json:"fromHTMLPaste" api:"optional,nullable"`
}

type InsertCoverRequest struct {
	Name string `json:"name"`
	ID   string `json:"id"`
}

type UploadAssetRequest struct {
	ID            *string                 `json:"id" api:"optional,nonnullable"`
	AssetsDirPath *string                 `json:"assetsDirPath" api:"optional,nonnullable"`
	Files         []*multipart.FileHeader `json:"file[]" api:"optional"`
}

type AssetStatData struct {
	Size       int64  `json:"size"`
	HSize      string `json:"hSize"`
	Created    int64  `json:"created"`
	HCreated   string `json:"hCreated"`
	Updated    int64  `json:"updated"`
	HUpdated   string `json:"hUpdated"`
	Downloaded *bool  `json:"downloaded,omitempty" api:"const=false"`
}

type AssetTextData struct {
	Text string `json:"text"`
}

// AssetOCRData 的列名来自识别工具的 TSV 表头，单元格均为文本。
type AssetOCRData struct {
	Text    string              `json:"text"`
	OCRJSON []map[string]string `json:"ocrJSON"`
}

type AssetRenameData struct {
	NewPath string `json:"newPath"`
}

type AssetAnnotationData struct {
	Data string `json:"data"`
}

type AssetPathData struct {
	Path string `json:"path"`
}

type AssetPathsData struct {
	Paths []string `json:"paths"`
}

type AssetUnusedItem struct {
	Item     string   `json:"item"`
	Name     string   `json:"name"`
	Path     string   `json:"path,omitempty"`
	BlockIDs []string `json:"blockIDs,omitempty"`
}

type AssetUploadSuccess struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
	Path  string `json:"path"`
}

type AssetUploadFailure struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
	Error string `json:"error"`
}

type AssetUploadData struct {
	ErrFiles    []string             `json:"errFiles"`
	FailedFiles []AssetUploadFailure `json:"failedFiles"`
	SuccFiles   []AssetUploadSuccess `json:"succFiles"`
	SuccMap     map[string]string    `json:"succMap"`
}

type AssetInsertCoverData struct {
	SuccFiles []AssetUploadSuccess `json:"succFiles"`
	SuccMap   map[string]string    `json:"succMap"`
}

func init() {
	InsertLocalAssets.decodeRequest = func(reader io.Reader) (request InsertLocalAssetsRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/asset/insertLocalAssets")
		if err != nil {
			return request, err
		}
		fromHTMLPaste := fields["fromHTMLPaste"]
		delete(fields, "fromHTMLPaste")
		if err = decodeRequestFields(reflect.ValueOf(&request).Elem(), fields); err != nil {
			return request, err
		}
		_ = json.Unmarshal(fromHTMLPaste, &request.FromHTMLPaste)
		return request, nil
	}
	AssetUploadCloudByAssetsPaths.decodeRequest = func(reader io.Reader) (request AssetPathsCloudUploadRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/asset/uploadCloudByAssetsPaths")
		if err != nil {
			return request, err
		}
		if len(fields["paths"]) == 0 || string(fields["paths"]) == "null" {
			return request, errors.New("[paths] is required")
		}
		err = decodeRequestFields(reflect.ValueOf(&request).Elem(), fields)
		return request, err
	}
}
