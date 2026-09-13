package apicontract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"reflect"
	"strings"
)

type ExportIDRequest struct {
	ID string `json:"id" api:"trim"`
}
type ExportIDsRequest struct {
	IDs []string `json:"ids"`
}
type ExportAttributeViewRequest struct {
	ID      string `json:"id" api:"trim"`
	BlockID string `json:"blockID" api:"trim"`
}
type ExportFolderRequest struct {
	Folder string `json:"folder" api:"trim"`
}
type ExportResourcesRequest struct {
	Name  *string   `json:"name" api:"optional"`
	Paths *[]string `json:"paths" api:"optional"`
}
type ExportNotebooksRequest struct {
	Notebooks []string `json:"notebooks" api:"optional,nullable,filterstrings"`
}

func (r ExportNotebooksRequest) IDs() (ids []string) {
	for _, id := range r.Notebooks {
		if id != "" {
			ids = append(ids, id)
		}
	}
	return
}

type ExportMarkdownOptions struct {
	AddTitle              *bool    `json:"addTitle" api:"optional"`
	InlineMemo            *bool    `json:"inlineMemo" api:"optional"`
	BlockRefMode          *float64 `json:"blockRefMode" api:"optional"`
	BlockEmbedMode        *float64 `json:"blockEmbedMode" api:"optional"`
	FileAnnotationRefMode *float64 `json:"fileAnnotationRefMode" api:"optional"`
	BlockRefTextLeft      *string  `json:"blockRefTextLeft" api:"optional"`
	BlockRefTextRight     *string  `json:"blockRefTextRight" api:"optional"`
	TagOpenMarker         *string  `json:"tagOpenMarker" api:"optional"`
	TagCloseMarker        *string  `json:"tagCloseMarker" api:"optional"`
	IncludeSubDocs        *bool    `json:"includeSubDocs" api:"optional"`
	IncludeRelatedDocs    *bool    `json:"includeRelatedDocs" api:"optional"`
	MarkdownYFM           *bool    `json:"markdownYFM" api:"optional"`
	RemoveAssetsID        *bool    `json:"removeAssetsID" api:"optional"`
	OptionsError          error    `json:"-"`
}

func (o ExportMarkdownOptions) Validate() error { return o.OptionsError }

type ExportMarkdownRequest struct {
	ExportIDRequest
	ExportMarkdownOptions
}
type ExportDocumentsMarkdownRequest struct {
	ExportIDsRequest
	ExportMarkdownOptions
}
type ExportNotebookMarkdownRequest struct {
	Notebook string `json:"notebook" api:"trim"`
	ExportMarkdownOptions
}
type ExportNotebooksMarkdownRequest struct {
	ExportNotebooksRequest
	ExportMarkdownOptions
}

type ExportMarkdownContentOptions struct {
	RefMode            *float64 `json:"refMode" api:"optional"`
	EmbedMode          *float64 `json:"embedMode" api:"optional"`
	YFM                *bool    `json:"yfm" api:"optional"`
	FillCSSVar         bool     `json:"fillCSSVar" api:"optional,nullable"`
	AdjustHeadingLevel bool     `json:"adjustHeadingLevel" api:"optional,nullable"`
	ImgTag             bool     `json:"imgTag" api:"optional,nullable"`
	AddTitle           *bool    `json:"addTitle" api:"optional"`
	OptionsError       error    `json:"-"`
}

func (o ExportMarkdownContentOptions) Validate() error { return o.OptionsError }

type ExportMarkdownContentRequest struct {
	ExportIDRequest
	ExportMarkdownContentOptions
}

type ExportDocxRequest struct {
	ID                      string `json:"id" api:"trim"`
	SavePath                string `json:"savePath" api:"trim"`
	RemoveAssets            bool   `json:"removeAssets"`
	Merge                   bool   `json:"merge" api:"optional,nullable"`
	MergeDocHeadingMode     string `json:"mergeDocHeadingMode" api:"optional,nullable"`
	MergeContentHeadingMode string `json:"mergeContentHeadingMode" api:"optional,nullable"`
}
type ExportTitleOptions struct {
	AddTitle    *bool  `json:"addTitle" api:"optional"`
	CustomTitle string `json:"customTitle" api:"optional,nullable,ignoretype"`
}
type ExportHTMLRequest struct {
	ID                      string `json:"id" api:"trim"`
	PDF                     bool   `json:"pdf"`
	SavePath                string `json:"savePath" api:"optional,nullable"`
	KeepFold                bool   `json:"keepFold" api:"optional,nullable"`
	Merge                   bool   `json:"merge" api:"optional,nullable"`
	MergeDocHeadingMode     string `json:"mergeDocHeadingMode" api:"optional,nullable"`
	MergeContentHeadingMode string `json:"mergeContentHeadingMode" api:"optional,nullable"`
	ExportTitleOptions
}
type ExportPreviewHTMLRequest struct {
	ID                      string `json:"id" api:"trim"`
	KeepFold                bool   `json:"keepFold" api:"optional,nullable"`
	Merge                   bool   `json:"merge" api:"optional,nullable"`
	Image                   bool   `json:"image" api:"optional,nullable"`
	MergeDocHeadingMode     string `json:"mergeDocHeadingMode" api:"optional,nullable"`
	MergeContentHeadingMode string `json:"mergeContentHeadingMode" api:"optional,nullable"`
	ExportTitleOptions
}
type ExportMarkdownHTMLRequest struct {
	ID       string `json:"id" api:"trim"`
	SavePath string `json:"savePath" api:"optional,nullable"`
}
type ExportTempContentRequest struct {
	Content string `json:"content"`
	ID      string `json:"id" api:"optional,nullable"`
}
type ExportBrowserHTMLRequest struct {
	Folder string `json:"folder" api:"trim"`
	HTML   string `json:"html" api:"trim"`
	Name   string `json:"name" api:"trim"`
}
type ProcessPDFRequest struct {
	ID                      string `json:"id" api:"trim"`
	Path                    string `json:"path" api:"trim"`
	Merge                   bool   `json:"merge" api:"optional,nullable"`
	MergeDocHeadingMode     string `json:"mergeDocHeadingMode" api:"optional,nullable"`
	MergeContentHeadingMode string `json:"mergeContentHeadingMode" api:"optional,nullable"`
	RemoveAssets            bool   `json:"removeAssets"`
	Watermark               bool   `json:"watermark"`
}
type ExportAsFileRequest struct {
	File *multipart.FileHeader `json:"file"`
	Type string                `json:"type"`
}
type CopyExportFileRequest struct {
	SrcPath string `json:"srcPath" api:"trim"`
	Dest    string `json:"dest" api:"trim"`
}

type ExportPathData struct {
	Path string `json:"path"`
}
type ExportZipData struct {
	Zip string `json:"zip"`
}
type ExportNamedZipData struct {
	Name string `json:"name"`
	Zip  string `json:"zip"`
}
type ExportNameData struct {
	Name string `json:"name"`
}
type ExportMarkdownContentData struct {
	HPath   string `json:"hPath"`
	Content string `json:"content"`
}
type ExportHTMLData struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Content string `json:"content"`
	Folder  string `json:"folder,omitempty"`
}
type ExportPreviewHTMLData struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Content string            `json:"content"`
	Attrs   map[string]string `json:"attrs"`
	Type    string            `json:"type"`
}
type ExportURLData struct {
	URL string `json:"url"`
}
type ExportPreviewData struct {
	HTML       string `json:"html"`
	FillCSSVar bool   `json:"fillCSSVar"`
}
type ExportFileData struct {
	File string `json:"file"`
}

// 导出请求保持字段检查顺序，附加 Markdown 选项的错误延迟到笔记本准入后报告。
func decodeExportFields(value reflect.Value, fields map[string]json.RawMessage) error {
	for i := 0; i < value.NumField(); i++ {
		field := value.Type().Field(i)
		if !field.IsExported() || field.Tag.Get("json") == "-" {
			continue
		}
		dest := value.Field(i)
		if field.Anonymous {
			err := decodeExportFields(dest, fields)
			if field.Type == reflect.TypeFor[ExportMarkdownOptions]() || field.Type == reflect.TypeFor[ExportMarkdownContentOptions]() {
				if err != nil {
					dest.FieldByName("OptionsError").Set(reflect.ValueOf(err))
				}
			} else if err != nil {
				return err
			}
			continue
		}
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		opts := "," + field.Tag.Get("api") + ","
		has := func(option string) bool { return strings.Contains(opts, ","+option+",") }
		if has("filterstrings") {
			var entries []json.RawMessage
			var values []string
			if json.Unmarshal(fields[name], &entries) == nil {
				for _, entry := range entries {
					var text string
					if json.Unmarshal(entry, &text) == nil && text != "" {
						values = append(values, text)
					}
				}
			}
			dest.Set(reflect.ValueOf(values))
			continue
		}
		raw := fields[name]
		if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			if has("optional") {
				continue
			}
			return fmt.Errorf("Field [%s] is required", name)
		}
		if err := decodeRequestValue(raw, dest); err != nil {
			if has("ignoretype") || value.Type() == reflect.TypeFor[ExportTitleOptions]() && name == "addTitle" {
				dest.SetZero()
				continue
			}
			kind := dest.Kind()
			if kind == reflect.Pointer {
				kind = dest.Type().Elem().Kind()
			}
			kindName := map[reflect.Kind]string{reflect.String: "String", reflect.Bool: "Boolean", reflect.Float64: "Number", reflect.Slice: "Array"}[kind]
			return fmt.Errorf("Field [%s] should be of type [%s]", name, kindName)
		}
		if has("trim") {
			text := strings.TrimSpace(dest.String())
			if text == "" {
				return fmt.Errorf("Field [%s] must not be empty", name)
			}
			dest.SetString(text)
		}
	}
	return nil
}

func bindExportDecoder[Request, Data any](endpoint *Endpoint[Request, Data]) {
	endpoint.decodeRequest = func(reader io.Reader) (request Request, err error) {
		fields, err := blockRequestFields(reader, endpoint.Definition().Path)
		if err != nil {
			return request, err
		}
		err = decodeExportFields(reflect.ValueOf(&request).Elem(), fields)
		return request, err
	}
}

func init() {
	bindExportDecoder(&ExportCodeBlock)
	bindExportDecoder(&ExportAttributeView)
	bindExportDecoder(&Export2Liandi)
	bindExportDecoder(&ExportDataInFolder)
	bindExportDecoder(&ExportResources)
	bindExportDecoder(&ExportNotebookMd)
	bindExportDecoder(&ExportNotebooksMd)
	bindExportDecoder(&ExportMds)
	bindExportDecoder(&ExportMd)
	bindExportDecoder(&ExportNotebookSY)
	bindExportDecoder(&ExportNotebooksSY)
	bindExportDecoder(&ExportSYs)
	bindExportDecoder(&ExportSY)
	bindExportDecoder(&ExportMdContent)
	bindExportDecoder(&ExportDocx)
	bindExportDecoder(&ExportMdHTML)
	bindExportDecoder(&ExportTempContent)
	bindExportDecoder(&ExportBrowserHTML)
	bindExportDecoder(&ExportPreviewHTML)
	bindExportDecoder(&ExportHTML)
	bindExportDecoder(&ProcessPDF)
	bindExportDecoder(&ExportPreview)
	bindExportDecoder(&CopyExportFile)
	bindExportDecoder(&ExportEPUB)
	bindExportDecoder(&ExportRTF)
	bindExportDecoder(&ExportODT)
	bindExportDecoder(&ExportMediaWiki)
	bindExportDecoder(&ExportOrgMode)
	bindExportDecoder(&ExportOPML)
	bindExportDecoder(&ExportTextile)
	bindExportDecoder(&ExportAsciiDoc)
	bindExportDecoder(&ExportReStructuredText)
}
