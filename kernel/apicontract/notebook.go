package apicontract

import "mime/multipart"

type ReorderNotebooksRequest struct {
	SourceIDs []string `json:"sourceIDs" api:"optional,nullable"`
	TargetID  string   `json:"targetID" api:"optional,nullable"`
	Position  string   `json:"position" api:"optional,nullable"`
}

type ReorderData struct {
	Changed    bool   `json:"changed"`
	Notebook   string `json:"notebook,omitempty"`
	ParentPath string `json:"parentPath,omitempty"`
}

type OpenNotebookRequest struct {
	NotebookIDRequest
	App string `json:"app" api:"optional,nullable,ignoretype"`
}

type NotebookEncryption struct {
	Spec       int     `json:"spec"`
	WrappedDEK *string `json:"wrappedDEK"`
	WrapNonce  *string `json:"wrapNonce"`
	Metadata   string  `json:"metadata,omitempty"`
	CreatedAt  int64   `json:"createdAt"`
}

type NotebookConf struct {
	Name                  string              `json:"name"`
	Sort                  int                 `json:"sort"`
	Icon                  string              `json:"icon"`
	Closed                bool                `json:"closed"`
	RefCreateSaveBox      string              `json:"refCreateSaveBox"`
	RefCreateSavePath     string              `json:"refCreateSavePath"`
	DocCreateSaveBox      string              `json:"docCreateSaveBox"`
	DocCreateSavePath     string              `json:"docCreateSavePath"`
	DocCreateTemplatePath string              `json:"docCreateTemplatePath"`
	DailyNoteSavePath     string              `json:"dailyNoteSavePath"`
	DailyNoteTemplatePath string              `json:"dailyNoteTemplatePath"`
	SortMode              int                 `json:"sortMode"`
	Encrypted             bool                `json:"encrypted"`
	BoxCrypt              *NotebookEncryption `json:"boxCrypt"`
}

type NotebookConfData struct {
	Box  string        `json:"box"`
	Name string        `json:"name"`
	Conf *NotebookConf `json:"conf"`
}

type ImportNotebookCryptoBackupRequest struct {
	File     *multipart.FileHeader `json:"file" api:"nonnullable"`
	Password string                `json:"password" api:"optional"`
}

type NotebookInfo struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	DocCount int    `json:"docCount"`
	Size     uint64 `json:"size"`
	HSize    string `json:"hSize"`
	Mtime    int64  `json:"mtime"`
	CTime    int64  `json:"ctime"`
	HMtime   string `json:"hMtime"`
	HCtime   string `json:"hCtime"`
}

type NotebookInfoData struct {
	BoxInfo *NotebookInfo `json:"boxInfo"`
}

type EncryptedNotebookStatus struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Unlocked bool   `json:"unlocked"`
	State    string `json:"state" api:"enum=Locked|Unlocking|Unlocked|Locking|Error"`
}

type EncryptedNotebookStatusData struct {
	Enabled              bool                      `json:"enabled"`
	State                string                    `json:"state" api:"enum=Disabled|Enabled|RecoveryRequired"`
	Count                int                       `json:"count"`
	Boxes                []EncryptedNotebookStatus `json:"boxes" api:"nonnullable"`
	MigrationPending     bool                      `json:"migrationPending"`
	MigrationBoxes       []string                  `json:"migrationBoxes"`
	HasHistoryDependency bool                      `json:"hasHistoryDependency"`
}

type NotebookPasswordRequest struct {
	Password string `json:"password" api:"trim"`
}

type CreateEncryptedNotebookRequest struct {
	Name string `json:"name"`
	NotebookPasswordRequest
}

type UnlockNotebookRequest struct {
	NotebookIDRequest
	NotebookPasswordRequest
}

type ChangeMasterPasswordRequest struct {
	OldPassword string `json:"oldPassword" api:"trim"`
	NewPassword string `json:"newPassword" api:"trim"`
}

type NotebookCryptoAutoLockRequest struct {
	AutoLockMinutes float64 `json:"autoLockMinutes"`
}

type NotebookCryptoBackupData struct {
	File string `json:"file"`
}

type NotebookIDRequest struct {
	Notebook string `json:"notebook" api:"trim"`
}

type CloseNotebookRequest struct {
	Notebook string `json:"notebook"`
}

type SetNotebookIconRequest struct {
	NotebookIDRequest
	Icon string `json:"icon"`
}

type RenameNotebookRequest struct {
	NotebookIDRequest
	Name string `json:"name"`
}

type CreateNotebookRequest struct {
	Name string `json:"name"`
}

type CreateNotebookData struct {
	Notebook *Notebook `json:"notebook"`
}

type ChangeSortNotebookRequest struct {
	Notebooks []string `json:"notebooks"`
}
