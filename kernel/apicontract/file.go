package apicontract

import "mime/multipart"

type PutFileRequest struct {
	IsDir   string                `json:"isDir" api:"optional"`
	App     string                `json:"app" api:"optional"`
	Path    string                `json:"path" api:"optional"`
	File    *multipart.FileHeader `json:"file" api:"optional,nonnullable"`
	ModTime string                `json:"modTime" api:"optional"`
}

type CopyFileRequest struct {
	Src  string `json:"src" api:"trim"`
	Dest string `json:"dest" api:"trim"`
}

type CopyFilesRequest struct {
	Srcs    []string `json:"srcs"`
	DestDir string   `json:"destDir"`
}

type FilePathRequest struct {
	Path string `json:"path" api:"trim"`
}
type FilePathData struct {
	Path string `json:"path"`
}
type ReadDirectoryRequest struct {
	Path string `json:"path"`
}
type DirectoryEntry struct {
	Name      string `json:"name"`
	IsDir     bool   `json:"isDir"`
	IsSymlink bool   `json:"isSymlink"`
	Updated   int64  `json:"updated"`
}
type RenameFileRequest struct {
	Path    string `json:"path" api:"trim"`
	NewPath string `json:"newPath" api:"trim"`
}
type RemoveFileRequest struct {
	App  string `json:"app" api:"optional,nullable"`
	Path string `json:"path" api:"trim"`
}
