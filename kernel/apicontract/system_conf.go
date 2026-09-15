package apicontract

type SystemAppConf struct {
	LogLevel       string                `json:"logLevel" api:"optional,nullable"`
	Appearance     *SettingAppearance    `json:"appearance" api:"optional,nullable"`
	Langs          []*SystemLang         `json:"langs" api:"optional,nullable"`
	Lang           string                `json:"lang" api:"optional,nullable"`
	FileTree       *SettingFileTree      `json:"fileTree" api:"optional,nullable"`
	Tag            *SystemTag            `json:"tag" api:"optional,nullable"`
	Editor         *SettingEditor        `json:"editor" api:"optional,nullable"`
	Export         *SettingExport        `json:"export" api:"optional,nullable"`
	Graph          *SystemGraph          `json:"graph" api:"optional,nullable"`
	UILayout       *map[string]JSONValue `json:"uiLayout" api:"optional,nullable"`
	UserData       string                `json:"userData" api:"optional,nullable"`
	ReadOnly       bool                  `json:"readonly" api:"optional,nullable"`
	ServerAddrs    []string              `json:"serverAddrs" api:"optional,nullable"`
	AccessAuthCode string                `json:"accessAuthCode" api:"optional,nullable"`
	OIDC           *SystemOIDC           `json:"oidc" api:"optional,nullable"`
	System         *SystemSystem         `json:"system" api:"optional,nullable"`
	Keymap         *map[string]JSONValue `json:"keymap" api:"optional,nullable"`
	Sync           *SystemSync           `json:"sync" api:"optional,nullable"`
	Search         *SettingSearch        `json:"search" api:"optional,nullable"`
	Flashcard      *SettingFlashcard     `json:"flashcard" api:"optional,nullable"`
	AI             *SettingAI            `json:"ai" api:"optional,nullable"`
	Secrets        *SettingSecrets       `json:"secrets" api:"optional,nullable"`
	Variables      *SettingVariables     `json:"variables" api:"optional,nullable"`
	Bazaar         *SettingBazaar        `json:"bazaar" api:"optional,nullable"`
	Stat           *SystemStat           `json:"stat" api:"optional,nullable"`
	Api            *SystemAPI            `json:"api" api:"optional,nullable"`
	Repo           *SystemRepo           `json:"repo" api:"optional,nullable"`
	NotebookCrypto *SystemNotebookCrypto `json:"notebookCrypto" api:"optional,nullable"`
	Publish        *SettingPublish       `json:"publish" api:"optional,nullable"`
	Onboarding     *SystemOnboarding     `json:"onboarding" api:"optional,nullable"`
	ShowChangelog  bool                  `json:"showChangelog" api:"optional,nullable"`
	CloudRegion    int                   `json:"cloudRegion" api:"optional,nullable"`
	Snippet        *SettingSnpt          `json:"snippet" api:"optional,nullable"`
	DataIndexState int                   `json:"dataIndexState" api:"optional,nullable"`
	CookieKey      string                `json:"cookieKey" api:"optional,nullable"`
	MCPOAuth       string                `json:"mcpOAuth" api:"optional,nullable"`
}

type SystemLang struct {
	Label string `json:"label" api:"optional,nullable"`
	Name  string `json:"name" api:"optional,nullable"`
}

type SystemTag struct {
	Sort int `json:"sort" api:"optional,nullable"`
}

type SystemGraph struct {
	MaxBlocks int                `json:"maxBlocks" api:"optional,nullable"`
	Local     *SystemLocalGraph  `json:"local" api:"optional,nullable"`
	Global    *SystemGlobalGraph `json:"global" api:"optional,nullable"`
}

type SystemLocalGraph struct {
	DailyNote  bool              `json:"dailyNote" api:"optional,nullable"`
	TypeFilter *SystemTypeFilter `json:"type" api:"optional,nullable"`
	D3         *SystemD3         `json:"d3" api:"optional,nullable"`
}

type SystemTypeFilter struct {
	Tag        bool `json:"tag" api:"optional,nullable"`
	Paragraph  bool `json:"paragraph" api:"optional,nullable"`
	Heading    bool `json:"heading" api:"optional,nullable"`
	Math       bool `json:"math" api:"optional,nullable"`
	Code       bool `json:"code" api:"optional,nullable"`
	Table      bool `json:"table" api:"optional,nullable"`
	List       bool `json:"list" api:"optional,nullable"`
	ListItem   bool `json:"listItem" api:"optional,nullable"`
	Blockquote bool `json:"blockquote" api:"optional,nullable"`
	Super      bool `json:"super" api:"optional,nullable"`
	Callout    bool `json:"callout" api:"optional,nullable"`
}

type SystemD3 struct {
	NodeSize        float64 `json:"nodeSize" api:"optional,nullable"`
	LineWidth       float64 `json:"linkWidth" api:"optional,nullable"`
	LineOpacity     float64 `json:"lineOpacity" api:"optional,nullable"`
	CenterStrength  float64 `json:"centerStrength" api:"optional,nullable"`
	CollideRadius   float64 `json:"collideRadius" api:"optional,nullable"`
	CollideStrength float64 `json:"collideStrength" api:"optional,nullable"`
	LinkDistance    int     `json:"linkDistance" api:"optional,nullable"`
	Arrow           bool    `json:"arrow" api:"optional,nullable"`
}

type SystemGlobalGraph struct {
	MinRefs    int               `json:"minRefs" api:"optional,nullable"`
	DailyNote  bool              `json:"dailyNote" api:"optional,nullable"`
	TypeFilter *SystemTypeFilter `json:"type" api:"optional,nullable"`
	D3         *SystemD3         `json:"d3" api:"optional,nullable"`
}

type SystemOIDC struct {
	Enabled      bool                   `json:"enabled" api:"optional,nullable"`
	Provider     string                 `json:"provider" api:"optional,nullable"`
	IssuerURL    string                 `json:"issuerURL" api:"optional,nullable"`
	ClientID     string                 `json:"clientID" api:"optional,nullable"`
	ClientSecret string                 `json:"clientSecret" api:"optional,nullable"`
	Scopes       []string               `json:"scopes" api:"optional,nullable"`
	RedirectURL  string                 `json:"redirectURL" api:"optional,nullable"`
	AllowAll     bool                   `json:"allowAll" api:"optional,nullable"`
	ClaimRules   []*SystemOIDCClaimRule `json:"claimRules" api:"optional,nullable"`
}

type SystemOIDCClaimRule struct {
	Claim    string   `json:"claim" api:"optional,nullable"`
	Operator string   `json:"operator" api:"optional,nullable"`
	Values   []string `json:"values" api:"optional,nullable"`
}

type SystemSystem struct {
	ID                                string              `json:"id" api:"optional,nullable"`
	Name                              string              `json:"name" api:"optional,nullable"`
	KernelVersion                     string              `json:"kernelVersion" api:"optional,nullable"`
	OS                                string              `json:"os" api:"optional,nullable"`
	OSPlatform                        string              `json:"osPlatform" api:"optional,nullable"`
	Container                         string              `json:"container" api:"optional,nullable"`
	IsMicrosoftStore                  bool                `json:"isMicrosoftStore" api:"optional,nullable"`
	HomeDir                           string              `json:"homeDir" api:"optional,nullable"`
	WorkspaceDir                      string              `json:"workspaceDir" api:"optional,nullable"`
	AppDir                            string              `json:"appDir" api:"optional,nullable"`
	ConfDir                           string              `json:"confDir" api:"optional,nullable"`
	DataDir                           string              `json:"dataDir" api:"optional,nullable"`
	NetworkServe                      bool                `json:"networkServe" api:"optional,nullable"`
	NetworkServeTLS                   bool                `json:"networkServeTLS" api:"optional,nullable"`
	NetworkProxy                      *SystemNetworkProxy `json:"networkProxy" api:"optional,nullable"`
	DownloadInstallPkg                bool                `json:"downloadInstallPkg" api:"optional,nullable"`
	UpdateChannel                     string              `json:"updateChannel,omitempty" api:"optional,nullable"`
	AutoLaunch2                       int                 `json:"autoLaunch2" api:"optional,nullable"`
	LockScreenMode                    int                 `json:"lockScreenMode" api:"optional,nullable"`
	EncryptedNotebookFollowSystemLock bool                `json:"encryptedNotebookFollowSystemLock" api:"optional,nullable"`
	DisabledFeatures                  []string            `json:"disabledFeatures" api:"optional,nullable"`
	MicrosoftDefenderExcluded         bool                `json:"microsoftDefenderExcluded" api:"optional,nullable"`
	SafeMode                          bool                `json:"safeMode" api:"optional,nullable"`
}

type SystemNetworkProxy struct {
	Scheme string `json:"scheme" api:"optional,nullable"`
	Host   string `json:"host" api:"optional,nullable"`
	Port   string `json:"port" api:"optional,nullable"`
}

type SystemSync struct {
	CloudName           string         `json:"cloudName" api:"optional,nullable"`
	Enabled             bool           `json:"enabled" api:"optional,nullable"`
	Perception          bool           `json:"perception" api:"optional,nullable"`
	Mode                int            `json:"mode" api:"optional,nullable"`
	Interval            int            `json:"interval" api:"optional,nullable"`
	Synced              int64          `json:"synced" api:"optional,nullable"`
	Stat                string         `json:"stat" api:"optional,nullable"`
	GenerateConflictDoc bool           `json:"generateConflictDoc" api:"optional,nullable"`
	AssetDownloadMode   int            `json:"assetDownloadMode" api:"optional,nullable"`
	Provider            int            `json:"provider" api:"optional,nullable"`
	S3                  *SystemS3      `json:"s3" api:"optional,nullable"`
	WebDAV              *SystemWebDAV  `json:"webdav" api:"optional,nullable"`
	Local               *SystemLocal   `json:"local" api:"optional,nullable"`
	LAN                 *SystemLANSync `json:"lan" api:"optional,nullable"`
}

type SystemS3 struct {
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

type SystemWebDAV struct {
	Endpoint       string `json:"endpoint" api:"optional,nullable"`
	Username       string `json:"username" api:"optional,nullable"`
	Password       string `json:"password" api:"optional,nullable"`
	SkipTlsVerify  bool   `json:"skipTlsVerify" api:"optional,nullable"`
	Timeout        int    `json:"timeout" api:"optional,nullable"`
	ConcurrentReqs int    `json:"concurrentReqs" api:"optional,nullable"`
}

type SystemLocal struct {
	Endpoint       string `json:"endpoint" api:"optional,nullable"`
	Timeout        int    `json:"timeout" api:"optional,nullable"`
	ConcurrentReqs int    `json:"concurrentReqs" api:"optional,nullable"`
}

type SystemLANSync struct {
	Enabled           bool `json:"enabled" api:"optional,nullable"`
	MaxConcurrentReqs int  `json:"maxConcurrentReqs" api:"optional,nullable"`
}

type SystemStat struct {
	TreeCount   int   `json:"treeCount" api:"optional,nullable"`
	CTreeCount  int   `json:"cTreeCount" api:"optional,nullable"`
	BlockCount  int   `json:"blockCount" api:"optional,nullable"`
	CBlockCount int   `json:"cBlockCount" api:"optional,nullable"`
	DataSize    int64 `json:"dataSize" api:"optional,nullable"`
	CDataSize   int64 `json:"cDataSize" api:"optional,nullable"`
	AssetsSize  int64 `json:"assetsSize" api:"optional,nullable"`
	CAssetsSize int64 `json:"cAssetsSize" api:"optional,nullable"`
}

type SystemAPI struct {
	Token string `json:"token" api:"optional,nullable"`
}

type SystemRepo struct {
	Key                   Base64Bytes `json:"key" api:"optional,nullable"`
	SyncIndexTiming       int64       `json:"syncIndexTiming" api:"optional,nullable"`
	IndexRetentionDays    int         `json:"indexRetentionDays" api:"optional,nullable"`
	RetentionIndexesDaily int         `json:"retentionIndexesDaily" api:"optional,nullable"`
}

type SystemNotebookCrypto struct {
	Enabled         bool               `json:"enabled" api:"optional,nullable"`
	MasterSalt      Base64Bytes        `json:"masterSalt" api:"optional,nullable"`
	KDFParams       SystemArgon2Params `json:"kdfParams" api:"optional,nullable"`
	KEKVerifier     Base64Bytes        `json:"kekVerifier" api:"optional,nullable"`
	VerifierNonce   Base64Bytes        `json:"verifierNonce" api:"optional,nullable"`
	AutoLockMinutes int                `json:"autoLockMinutes" api:"optional,nullable"`
	Spec            int                `json:"spec" api:"optional,nullable"`
	BackupID        string             `json:"backupID,omitempty" api:"optional,nullable"`
	CreatedAt       int64              `json:"createdAt,omitempty" api:"optional,nullable"`
	Checksum        string             `json:"checksum,omitempty" api:"optional,nullable"`
	KEKMAC          Base64Bytes        `json:"kekMAC,omitempty" api:"optional,nullable"`
	HistoryKEKs     []Base64Bytes      `json:"historyKEKs,omitempty" api:"optional,nullable"`
}

type SystemArgon2Params struct {
	Memory      uint32 `json:"memory" api:"optional,nullable"`
	Iterations  uint32 `json:"iterations" api:"optional,nullable"`
	Parallelism uint8  `json:"parallelism" api:"optional,nullable"`
	KeyLength   uint32 `json:"keyLength" api:"optional,nullable"`
}

type SystemOnboarding struct {
	State      string `json:"state" api:"optional,nullable"`
	NewUser    bool   `json:"newUser" api:"optional,nullable"`
	Dismissed  bool   `json:"dismissed" api:"optional,nullable"`
	NotebookID string `json:"notebookID" api:"optional,nullable"`
	DocumentID string `json:"documentID" api:"optional,nullable"`
}

type SystemFont struct {
	Family      string   `json:"family" api:"optional,nullable"`
	Weight      int      `json:"weight" api:"optional,nullable"`
	DisplayName string   `json:"displayName" api:"optional,nullable"`
	Aliases     []string `json:"aliases,omitempty" api:"optional,nullable"`
	Spacing     string   `json:"spacing,omitempty" api:"optional,nullable"`
}

type SystemCustomFont struct {
	ID          string   `json:"id" api:"optional,nullable"`
	Family      string   `json:"family" api:"optional,nullable"`
	Weight      int      `json:"weight" api:"optional,nullable"`
	DisplayName string   `json:"displayName" api:"optional,nullable"`
	Aliases     []string `json:"aliases,omitempty" api:"optional,nullable"`
	Spacing     string   `json:"spacing,omitempty" api:"optional,nullable"`
	URL         string   `json:"url" api:"optional,nullable"`
}
