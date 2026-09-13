package apicontract

type ZipRequest struct {
	Path    string `json:"path" api:"trim"`
	ZipPath string `json:"zipPath" api:"trim"`
}

type UnzipRequest struct {
	ZipPath string `json:"zipPath" api:"trim"`
	Path    string `json:"path"`
}
