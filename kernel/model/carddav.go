// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"golang.org/x/sync/errgroup"
	"io"
	"net/http"
	"os"
	"path"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/emersion/go-vcard"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/dav"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	// REF: https://developers.google.com/people/carddav#resources
	CardDavPrefixPath        = "/carddav"
	CardDavPrincipalsPath    = CardDavPrefixPath + "/principals"      // 0 resourceTypeRoot
	CardDavUserPrincipalPath = CardDavPrincipalsPath + "/main"        // 1 resourceTypeUserPrincipal
	CardDavHomeSetPath       = CardDavUserPrincipalPath + "/contacts" // 2 resourceTypeAddressBookHomeSet

	CardDavDefaultAddressBookPath = CardDavHomeSetPath + "/default" // 3 resourceTypeAddressBook
	CardDavDefaultAddressBookName = "default"

	CardDavAddressBooksMetaDataFilePath   = CardDavHomeSetPath + "/address-books.json"
	CardDavAddressBooksPropertiesFilePath = CardDavHomeSetPath + "/properties.json"

	VCardFileExt = "." + vcard.Extension // .vcf
)

type CardDavPathDepth int

const (
	cardDavPathDepth_Root          CardDavPathDepth = 1 + iota // /carddav
	cardDavPathDepth_Principals                                // /carddav/principals
	cardDavPathDepth_UserPrincipal                             // /carddav/principals/main
	cardDavPathDepth_HomeSet                                   // /carddav/principals/main/contacts
	cardDavPathDepth_AddressBook                               // /carddav/principals/main/contacts/default
	cardDavPathDepth_Address                                   // /carddav/principals/main/contacts/default/id.vcf
)

// AddressDataType 是通讯录支持的联系人媒体类型。
type AddressDataType struct {
	ContentType string
	Version     string
}

// AddressBookMetaData 是 address-books.json 中一个通讯录的元数据。早期版本直接序列化 go-webdav 的
// carddav.AddressBook，文件经数据同步在设备间共享，字段名和 JSON 结构必须与之保持一致。
type AddressBookMetaData struct {
	Path                 string
	Name                 string
	Description          string
	MaxResourceSize      int64
	SupportedAddressData []AddressDataType
}

var (
	addressBookMaxResourceSize      int64 = 0
	addressBookSupportedAddressData       = []AddressDataType{
		{
			ContentType: vcard.MIMEType,
			Version:     "3.0",
		},
		{
			ContentType: vcard.MIMEType,
			Version:     "4.0",
		},
	}

	defaultAddressBook = AddressBookMetaData{
		Path:                 CardDavDefaultAddressBookPath,
		Name:                 CardDavDefaultAddressBookName,
		Description:          "Default address book",
		MaxResourceSize:      addressBookMaxResourceSize,
		SupportedAddressData: addressBookSupportedAddressData,
	}
	contacts = Contacts{
		loaded:        false,
		changed:       false,
		lock:          sync.Mutex{},
		books:         sync.Map{},
		booksMetaData: []*AddressBookMetaData{},
	}

	ErrorCardDavPathInvalid = errors.New("CardDAV: path is invalid")

	ErrorCardDavBookNotFound    = errors.New("CardDAV: address book not found")
	ErrorCardDavBookPathInvalid = errors.New("CardDAV: address book path is invalid")

	ErrorCardDavAddressNotFound                 = errors.New("CardDAV: address not found")
	ErrorCardDavAddressFileExtensionNameInvalid = errors.New("CardDAV: address file extension name is invalid")
	ErrorCardDavBookExists                      = errors.New("CardDAV: address book already exists")

	cardDavReadErrorCodes = map[error]int{
		ErrorCardDavPathInvalid:                     http.StatusNotFound,
		ErrorCardDavBookNotFound:                    http.StatusNotFound,
		ErrorCardDavBookPathInvalid:                 http.StatusNotFound,
		ErrorCardDavAddressNotFound:                 http.StatusNotFound,
		ErrorCardDavAddressFileExtensionNameInvalid: http.StatusNotFound,
	}
	// PUT 到不存在的通讯录时缺少父集合（RFC 4918 §9.7.1）；对象名不合法时不允许在此创建资源
	cardDavWriteErrorCodes = map[error]int{
		ErrorCardDavBookNotFound:                    http.StatusConflict,
		ErrorCardDavBookPathInvalid:                 http.StatusForbidden,
		ErrorCardDavAddressFileExtensionNameInvalid: http.StatusForbidden,
	}
)

// AddressBooksMetaDataFilePath returns the absolute path of the address books metadata file
func AddressBooksMetaDataFilePath() string {
	return DavPath2DirectoryPath(CardDavAddressBooksMetaDataFilePath)
}

// AddressBooksPropertiesFilePath 返回通讯录死属性文件的绝对路径。
func AddressBooksPropertiesFilePath() string {
	return DavPath2DirectoryPath(CardDavAddressBooksPropertiesFilePath)
}

func GetCardDavPathDepth(urlPath string) CardDavPathDepth {
	urlPath = PathCleanWithSlash(urlPath)
	return CardDavPathDepth(len(strings.Split(urlPath, "/")) - 1)
}

// isCardDavAddressBookPath 判断路径是否为 home set 下的通讯录；通讯录只能建在这里，目录也就只会落在 storage/carddav 下。
func isCardDavAddressBookPath(bookPath string) bool {
	return GetCardDavPathDepth(bookPath) == cardDavPathDepth_AddressBook && strings.HasPrefix(bookPath, CardDavHomeSetPath+"/")
}

// ParseAddressPath parses address path to address book path and address ID
func ParseAddressPath(addressPath string) (addressBookPath string, addressID string, err error) {
	addressBookPath, addressFileName := path.Split(addressPath)
	addressBookPath = PathCleanWithSlash(addressBookPath)
	addressID = path.Base(addressFileName)
	addressFileExt := util.Ext(addressFileName)

	if !isCardDavAddressBookPath(addressBookPath) {
		err = ErrorCardDavBookPathInvalid
		return
	}

	if addressFileExt != VCardFileExt {
		err = ErrorCardDavAddressFileExtensionNameInvalid
		return
	}

	return
}

func decodeCards(content []byte) (cards []vcard.Card, err error) {
	decoder := vcard.NewDecoder(bytes.NewReader(content))
	for {
		card, err := decoder.Decode()
		if err != nil {
			if err == io.EOF {
				break
			}
			return nil, err
		}
		cards = append(cards, card)
	}
	return
}

type Contacts struct {
	loaded        bool
	changed       bool
	lock          sync.Mutex // load & save
	books         sync.Map   // Path -> *AddressBook
	booksMetaData []*AddressBookMetaData
	properties    map[string][]*dav.Node // Path -> 死属性
}

// load all contacts
func (c *Contacts) load() error {
	c.loaded = false
	c.books.Clear()

	// load address books meta data
	addressBooksMetaDataFilePath := AddressBooksMetaDataFilePath()
	metaData, err := os.ReadFile(addressBooksMetaDataFilePath)
	if os.IsNotExist(err) {
		// create & save default address book
		addressBook := defaultAddressBook
		addressBook.SupportedAddressData = slices.Clone(addressBookSupportedAddressData)
		c.booksMetaData = []*AddressBookMetaData{&addressBook}
		if err := c.saveAddressBooksMetaData(); err != nil {
			return err
		}
	} else {
		// load meta data file
		c.booksMetaData = []*AddressBookMetaData{}
		if err = gulu.JSON.UnmarshalJSON(metaData, &c.booksMetaData); err != nil {
			logging.LogErrorf("unmarshal address books meta data failed: %s", err)
			return err
		}
	}
	if c.properties, err = loadDAVDeadProperties(AddressBooksPropertiesFilePath()); err != nil {
		return err
	}

	// load vCard files (*.vcf)
	wg := &errgroup.Group{}
	for _, addressBookMetaData := range c.booksMetaData {
		addressBook := &AddressBook{
			Changed:       false,
			DirectoryPath: DavPath2DirectoryPath(addressBookMetaData.Path),
			MetaData:      addressBookMetaData,
			Addresses:     sync.Map{},
		}
		c.books.Store(addressBookMetaData.Path, addressBook)
		wg.Go(func() error {
			return addressBook.load()
		})
	}
	if err := wg.Wait(); err != nil {
		return err
	}

	c.loaded = true
	c.changed = false
	return nil
}

// save all contacts
func (c *Contacts) saveAddressBooksMetaData() error {
	return SaveMetaData(c.booksMetaData, AddressBooksMetaDataFilePath())
}

func (c *Contacts) Load() error {
	c.lock.Lock()
	defer c.lock.Unlock()

	if !c.loaded {
		return c.load()
	}
	return nil
}

func (c *Contacts) GetAddress(addressPath string) (addressBook *AddressBook, addressObject *AddressObject, err error) {
	bookPath, addressID, err := ParseAddressPath(addressPath)
	if err != nil {
		return
	}

	if value, ok := c.books.Load(bookPath); ok {
		addressBook = value.(*AddressBook)
	} else {
		err = ErrorCardDavBookNotFound
		return
	}

	if value, ok := addressBook.Addresses.Load(addressID); ok {
		addressObject = value.(*AddressObject)
	} else {
		err = ErrorCardDavAddressNotFound
		return
	}

	return
}

func (c *Contacts) DeleteAddress(addressPath string, conditions *DAVConditions) (addressBook *AddressBook, addressObject *AddressObject, err error) {
	bookPath, addressID, err := ParseAddressPath(addressPath)
	if err != nil {
		logging.LogErrorf("parse address path [%s] failed: %s", addressPath, err)
		return
	}

	if value, ok := c.books.Load(bookPath); ok {
		addressBook = value.(*AddressBook)
	} else {
		err = ErrorCardDavBookNotFound
		return
	}

	if value, loaded := addressBook.Addresses.Load(addressID); loaded {
		addressObject = value.(*AddressObject)
	} else {
		err = ErrorCardDavAddressNotFound
		return
	}

	if err = conditions.check(true, addressObject.Data.ETag); err != nil {
		return
	}

	if err = os.Remove(addressObject.FilePath); err != nil {
		c.loaded = false
		logging.LogErrorf("remove file [%s] failed: %s", addressObject.FilePath, err)
		return
	}
	addressBook.Addresses.Delete(addressID)

	return
}

func (c *Contacts) ListAddressBooks() (addressBooks []AddressBookMetaData, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	for _, addressBook := range c.booksMetaData {
		addressBooks = append(addressBooks, *addressBook)
	}
	return
}

func (c *Contacts) GetAddressBook(path string) (addressBook *AddressBookMetaData, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	if book, ok := c.books.Load(path); ok {
		metaData := *book.(*AddressBook).MetaData
		addressBook = &metaData
		return
	}

	err = ErrorCardDavBookNotFound
	return
}

// CreateAddressBook 在 home set 下创建新通讯录并保存它的死属性；RFC 4918 §9.3 要求 MKCOL 不能作用于已存在的资源，
// 失败时恢复原状态。
func (c *Contacts) CreateAddressBook(addressBookMetaData *AddressBookMetaData, properties []*dav.Node) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	if !isCardDavAddressBookPath(addressBookMetaData.Path) || CardDavAddressBooksMetaDataFilePath == addressBookMetaData.Path || CardDavAddressBooksPropertiesFilePath == addressBookMetaData.Path {
		return dav.NewConditionError(http.StatusForbidden, dav.NewElement(dav.CardDAVName("addressbook-collection-location-ok")))
	}
	if _, ok := c.books.Load(addressBookMetaData.Path); ok {
		return dav.NewError(http.StatusMethodNotAllowed, ErrorCardDavBookExists)
	}

	addressBook := &AddressBook{
		Changed:       false,
		DirectoryPath: DavPath2DirectoryPath(addressBookMetaData.Path),
		MetaData:      addressBookMetaData,
		Addresses:     sync.Map{},
	}
	_, statErr := os.Stat(addressBook.DirectoryPath)
	createdDirectory := os.IsNotExist(statErr)
	// 目录可能因同步或中断的操作而已经存在，载入其中的联系人以免之后被同名写入覆盖
	if err = addressBook.load(); err != nil {
		return
	}

	c.books.Store(addressBookMetaData.Path, addressBook)
	c.booksMetaData = append(c.booksMetaData, addressBookMetaData)
	if nil == c.properties {
		c.properties = map[string][]*dav.Node{}
	}
	previousProperties, hadProperties := c.properties[addressBookMetaData.Path]
	if 0 < len(properties) {
		c.properties[addressBookMetaData.Path] = properties
	} else {
		delete(c.properties, addressBookMetaData.Path)
	}
	if err = c.saveAddressBooksMetaData(); err == nil {
		if err = saveDAVDeadProperties(c.properties, AddressBooksPropertiesFilePath()); err != nil {
			c.loaded = false
		}
	}
	if err != nil {
		c.books.Delete(addressBookMetaData.Path)
		c.booksMetaData = c.booksMetaData[:len(c.booksMetaData)-1]
		if hadProperties {
			c.properties[addressBookMetaData.Path] = previousProperties
		} else {
			delete(c.properties, addressBookMetaData.Path)
		}
		if createdDirectory {
			_ = os.Remove(addressBook.DirectoryPath)
		}
		return
	}
	return
}

// UpdateAddressBook 在持有锁时修改通讯录的元数据和死属性；update 返回错误时不做任何修改，保存失败时恢复内存状态。
func (c *Contacts) UpdateAddressBook(bookPath string, update func(metaData *AddressBookMetaData, properties *[]*dav.Node) error) error {
	c.lock.Lock()
	defer c.lock.Unlock()

	value, ok := c.books.Load(bookPath)
	if !ok {
		return dav.NewError(http.StatusNotFound, ErrorCardDavBookNotFound)
	}
	addressBook := value.(*AddressBook)
	metaData := *addressBook.MetaData
	metaData.SupportedAddressData = slices.Clone(metaData.SupportedAddressData)
	properties := cloneDAVNodes(c.properties[bookPath])
	if err := update(&metaData, &properties); err != nil {
		return err
	}

	previousMetaData, previousProperties := *addressBook.MetaData, c.properties[bookPath]
	metaDataChanged := previousMetaData.Name != metaData.Name || previousMetaData.Description != metaData.Description
	propertiesChanged := !sameDAVNodes(previousProperties, properties)
	if nil == c.properties {
		c.properties = map[string][]*dav.Node{}
	}
	*addressBook.MetaData = metaData
	if 0 < len(properties) {
		c.properties[bookPath] = properties
	} else {
		delete(c.properties, bookPath)
	}
	var err error
	if metaDataChanged {
		err = c.saveAddressBooksMetaData()
	}
	if err == nil && propertiesChanged {
		err = saveDAVDeadProperties(c.properties, AddressBooksPropertiesFilePath())
	}
	if err != nil {
		*addressBook.MetaData = previousMetaData
		c.properties[bookPath] = previousProperties
		c.loaded = false
	}
	return err
}

// AddressBookProperties 返回通讯录死属性的副本。
func (c *Contacts) AddressBookProperties(bookPath string) []*dav.Node {
	c.lock.Lock()
	defer c.lock.Unlock()

	return cloneDAVNodes(c.properties[bookPath])
}

func (c *Contacts) DeleteAddressBook(path string, conditions *DAVConditions) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	value, ok := c.books.Load(path)
	if !ok {
		return dav.NewError(http.StatusNotFound, ErrorCardDavBookNotFound)
	}
	addressBook := value.(*AddressBook)
	if err = conditions.check(true, ""); err != nil {
		return
	}

	// 先删除目录，失败时缓存和元数据仍与磁盘一致
	if err = os.RemoveAll(addressBook.DirectoryPath); err != nil {
		c.loaded = false
		logging.LogErrorf("remove directory [%s] failed: %s", addressBook.DirectoryPath, err)
		return
	}

	c.books.Delete(path)
	for i, item := range c.booksMetaData {
		if item.Path == path {
			c.booksMetaData = append(c.booksMetaData[:i], c.booksMetaData[i+1:]...)
			break
		}
	}

	if err = c.saveAddressBooksMetaData(); err != nil {
		c.loaded = false
		return
	}
	if _, ok = c.properties[path]; ok {
		delete(c.properties, path)
		if err = saveDAVDeadProperties(c.properties, AddressBooksPropertiesFilePath()); err != nil {
			c.loaded = false
			return
		}
	}

	return nil
}

func (c *Contacts) GetAddressObject(addressPath string) (addressObject *AddressObjectData, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	_, address, err := c.GetAddress(addressPath)
	if err != nil {
		return
	}
	return address.Data, nil
}

// ListAddressObjects 返回通讯录中的全部联系人，按路径排序。
func (c *Contacts) ListAddressObjects(bookPath string) (addressObjects []*AddressObjectData, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	var addressBook *AddressBook
	if value, ok := c.books.Load(bookPath); ok {
		addressBook = value.(*AddressBook)
	} else {
		err = ErrorCardDavBookNotFound
		return
	}

	addressBook.Addresses.Range(func(id any, address any) bool {
		addressObjects = append(addressObjects, address.(*AddressObject).Data)
		return true
	})
	sort.Slice(addressObjects, func(i, j int) bool { return addressObjects[i].Path < addressObjects[j].Path })
	return
}

// PutAddressObject 写入联系人；created 表示请求前该资源不存在（RFC 9110 §9.3.4 据此区分 201 与 204）。
func (c *Contacts) PutAddressObject(addressPath string, card vcard.Card, conditions *DAVConditions) (addressObject *AddressObjectData, created bool, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	bookPath, addressID, err := ParseAddressPath(addressPath)
	if err != nil {
		logging.LogErrorf("parse address path [%s] failed: %s", addressPath, err)
		return
	}

	var addressBook *AddressBook
	if value, ok := c.books.Load(bookPath); ok {
		addressBook = value.(*AddressBook)
	} else {
		err = ErrorCardDavBookNotFound
		return
	}

	etag := ""
	if value, ok := addressBook.Addresses.Load(addressID); ok {
		etag = value.(*AddressObject).Data.ETag
	}
	if err = conditions.check("" != etag, etag); err != nil {
		return
	}

	if err = addressBook.validateAddress(addressPath, addressID, card); err != nil {
		return
	}

	// Do not mutate a cached object until its replacement is persisted.
	address := &AddressObject{
		Changed:  true,
		FilePath: DavPath2DirectoryPath(addressPath),
		BookPath: bookPath,
		Data: &AddressObjectData{
			Card: card,
		},
	}

	err = address.save(true)
	if err != nil {
		c.loaded = false
		return
	}

	err = address.update()
	if err != nil {
		c.loaded = false
		return
	}

	addressBook.Addresses.Store(addressID, address)
	return address.Data, "" == etag, nil
}

func (c *Contacts) DeleteAddressObject(addressPath string, conditions *DAVConditions) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	_, _, err = c.DeleteAddress(addressPath, conditions)
	if err != nil {
		return
	}

	return
}

type AddressBook struct {
	Changed       bool
	DirectoryPath string
	MetaData      *AddressBookMetaData
	Addresses     sync.Map // id -> *AddressObject
}

func cardDAVPrecondition(name string, children ...*dav.Node) error {
	return dav.NewConditionError(http.StatusConflict, dav.NewElement(dav.CardDAVName(name), children...))
}

// validateAddress 检查 RFC 6352 §6.3.2.1 对新写入联系人的前置条件；已有数据不受影响，只校验本次写入。
func (b *AddressBook) validateAddress(addressPath, addressID string, card vcard.Card) error {
	if err := vcard.NewEncoder(io.Discard).Encode(card); err != nil {
		return cardDAVPrecondition("valid-address-data")
	}

	// vCard 3.0 的 UID 是可选属性，没有 UID 的联系人不参与冲突检查
	uid := card.Value(vcard.FieldUID)
	conflict := ""
	b.Addresses.Range(func(id any, value any) bool {
		address := value.(*AddressObject)
		existingUID := address.Data.Card.Value(vcard.FieldUID)
		if id.(string) == addressID {
			if "" != existingUID && existingUID != uid {
				conflict = addressPath
			}
		} else if "" != uid && existingUID == uid {
			conflict = address.Data.Path
		}
		return "" == conflict
	})
	if "" != conflict {
		// RFC 6352 §6.3.2.1 要求在条件元素中给出已使用该 UID 的资源
		return cardDAVPrecondition("no-uid-conflict", dav.HrefNode(conflict))
	}
	return nil
}

// load an address book from multiple *.vcf files
func (b *AddressBook) load() error {
	if err := os.MkdirAll(b.DirectoryPath, 0755); err != nil {
		logging.LogErrorf("create directory [%s] failed: %s", b.DirectoryPath, err)
		return err
	}

	entries, err := os.ReadDir(b.DirectoryPath)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", b.DirectoryPath, err)
		return err
	}

	wg := &errgroup.Group{}
	for _, entry := range entries {
		if !entry.IsDir() {
			filename := entry.Name()
			ext := util.Ext(filename)
			if ext == VCardFileExt {
				wg.Go(func() error {
					// load cards
					addressFilePath := path.Join(b.DirectoryPath, filename)
					address := &AddressObject{
						FilePath: addressFilePath,
						BookPath: b.MetaData.Path,
						Data:     &AddressObjectData{},
					}
					if err := address.update(); err != nil {
						return err
					}
					vCards, err := decodeCards(address.Data.Content)
					if err != nil {
						logging.LogErrorf("decode vCard file [%s] failed: %s", addressFilePath, err)
						return err
					}

					switch len(vCards) {
					case 0: // invalid file
						return errors.New("CardDAV: no card in persisted file")
					case 1: // file contain 1 card
						address.Data.Card = vCards[0]
						id := path.Base(filename)
						b.Addresses.Store(id, address)
					default: // file contain multiple cards
						// Create a file for each card
						addressesWaitGroup := &errgroup.Group{}
						for _, vCard := range vCards {
							addressesWaitGroup.Go(func() error {
								// 文件名由卡片内容决定：多台设备同步前各自拆分同一文件时得到同名同内容的文件，同步后不会重复
								var encoded bytes.Buffer
								if err := vcard.NewEncoder(&encoded).Encode(vCard); err != nil {
									return err
								}
								sum := sha256.Sum256(encoded.Bytes())
								filename_ := strings.TrimSuffix(filename, VCardFileExt) + "-" + hex.EncodeToString(sum[:8]) + VCardFileExt
								address := &AddressObject{
									FilePath: path.Join(b.DirectoryPath, filename_),
									BookPath: b.MetaData.Path,
									Data: &AddressObjectData{
										Card: vCard,
									},
								}
								if err := address.save(true); err != nil {
									return err
								}
								if err := address.update(); err != nil {
									return err
								}

								b.Addresses.Store(filename_, address)
								return nil
							})
						}

						if err := addressesWaitGroup.Wait(); err != nil {
							return err
						}
						// Delete original file with multiple cards
						if err := os.Remove(addressFilePath); err != nil {
							logging.LogErrorf("remove file [%s] failed: %s", addressFilePath, err)
							return err
						}
					}
					return nil
				})
			}
		}
	}
	return wg.Wait()
}

type AddressObject struct {
	Changed  bool
	FilePath string
	BookPath string
	Data     *AddressObjectData
}

// AddressObjectData 是联系人资源的当前表示。
type AddressObjectData struct {
	Path    string
	ModTime time.Time
	ETag    string
	// Content 是持久化文件的原始字节，GET 与完整的 address-data 原样返回，ETag 也由它计算
	Content []byte
	Card    vcard.Card
}

// save an address to *.vcf file
func (o *AddressObject) save(force bool) error {
	if force || o.Changed {
		var addressData bytes.Buffer

		// encode data
		encoder := vcard.NewEncoder(&addressData)
		if err := encoder.Encode(o.Data.Card); err != nil {
			logging.LogErrorf("encode card [%s] failed: %s", o.Data.Path, err)
			return err
		}

		// create directory
		dirPath := path.Dir(o.FilePath)
		if err := os.MkdirAll(dirPath, 0755); err != nil {
			logging.LogErrorf("create directory [%s] failed: %s", dirPath, err)
			return err
		}

		// write file
		if err := writeDAVFile(o.FilePath, addressData.Bytes(), 0755); err != nil {
			logging.LogErrorf("write file [%s] failed: %s", o.FilePath, err)
			return err
		}

		o.Changed = false
	}
	return nil
}

// update 从磁盘重新读取联系人的字节、修改时间和 ETag
func (o *AddressObject) update() error {
	fileInfo, err := os.Stat(o.FilePath)
	if err != nil {
		logging.LogErrorf("get file [%s] info failed: %s", o.FilePath, err)
		return err
	}
	content, err := os.ReadFile(o.FilePath)
	if err != nil {
		logging.LogErrorf("read vCard file [%s] failed: %s", o.FilePath, err)
		return err
	}

	o.Data.Path = PathJoinWithSlash(o.BookPath, fileInfo.Name())
	o.Data.ModTime = fileInfo.ModTime()
	o.Data.Content = content
	o.Data.ETag = davContentETag(content)
	return nil
}

var cardDAVConfig = &davConfig{
	namespace:  dav.NamespaceCardDAV,
	capability: "addressbook",
	wellKnown:  "carddav",

	prefix:     CardDavPrefixPath,
	principals: CardDavPrincipalsPath,
	principal:  CardDavUserPrincipalPath,
	homeSet:    CardDavHomeSetPath,

	homeSetProp:     dav.CardDAVName("addressbook-home-set"),
	collectionType:  dav.CardDAVName("addressbook"),
	descriptionProp: dav.CardDAVName("addressbook-description"),
	dataProp:        dav.CardDAVName("address-data"),

	queryReport:    dav.CardDAVName("addressbook-query"),
	multigetReport: dav.CardDAVName("addressbook-multiget"),

	mimeType:          vcard.MIMEType,
	contentCondition:  "supported-address-data",
	locationCondition: "addressbook-collection-location-ok",
	protected:         []xml.Name{dav.CardDAVName("supported-address-data")},
}

// cardDAVService 把通讯录存储接入通用 DAV 处理器。
type cardDAVService struct {
	store *Contacts
}

func (s *cardDAVService) load() error {
	return s.store.Load()
}

func addressBookCollection(metaData AddressBookMetaData, properties []*dav.Node) *davCollection {
	addressData := metaData.SupportedAddressData
	if 0 == len(addressData) {
		addressData = addressBookSupportedAddressData
	}
	return &davCollection{path: metaData.Path, maxResourceSize: metaData.MaxResourceSize, addressData: slices.Clone(addressData),
		state: davCollectionState{name: metaData.Name, description: metaData.Description, properties: properties}}
}

func addressDAVObject(data *AddressObjectData) *davObject {
	return &davObject{path: data.Path, etag: data.ETag, modTime: data.ModTime, content: data.Content, card: data.Card}
}

func (s *cardDAVService) collections() (collections []*davCollection) {
	s.store.lock.Lock()
	defer s.store.lock.Unlock()

	for _, metaData := range s.store.booksMetaData {
		collections = append(collections, addressBookCollection(*metaData, cloneDAVNodes(s.store.properties[metaData.Path])))
	}
	return
}

func (s *cardDAVService) collection(p string) *davCollection {
	s.store.lock.Lock()
	defer s.store.lock.Unlock()

	value, ok := s.store.books.Load(p)
	if !ok {
		return nil
	}
	return addressBookCollection(*value.(*AddressBook).MetaData, cloneDAVNodes(s.store.properties[p]))
}

func (s *cardDAVService) objects(collectionPath string) (objects []*davObject) {
	list, _ := s.store.ListAddressObjects(collectionPath)
	for _, data := range list {
		objects = append(objects, addressDAVObject(data))
	}
	return
}

func (s *cardDAVService) object(p string) *davObject {
	data, err := s.store.GetAddressObject(p)
	if err != nil {
		return nil
	}
	return addressDAVObject(data)
}

func (s *cardDAVService) collectionProps(collection *davCollection) []davProp {
	name := dav.CardDAVName("supported-address-data")
	return []davProp{{name: name, allprop: true, value: func() *dav.Node {
		node := dav.NewElement(name)
		for _, addressData := range collection.addressData {
			node.Append(dav.NewElement(dav.CardDAVName("address-data-type")).WithAttr("content-type", addressData.ContentType).WithAttr("version", addressData.Version))
		}
		return node
	}}}
}

func (s *cardDAVService) validateProperty(*dav.Node) error {
	return nil
}

func (s *cardDAVService) createCollection(p string, state *davCollectionState) error {
	return s.store.CreateAddressBook(&AddressBookMetaData{
		Path:                 p,
		Name:                 state.name,
		Description:          state.description,
		MaxResourceSize:      addressBookMaxResourceSize,
		SupportedAddressData: slices.Clone(addressBookSupportedAddressData),
	}, state.properties)
}

func (s *cardDAVService) updateCollection(p string, update func(state *davCollectionState) error) error {
	return s.store.UpdateAddressBook(p, func(metaData *AddressBookMetaData, properties *[]*dav.Node) error {
		state := davCollectionState{name: metaData.Name, description: metaData.Description, properties: *properties}
		if err := update(&state); err != nil {
			return err
		}
		metaData.Name, metaData.Description, *properties = state.name, state.description, state.properties
		return nil
	})
}

func (s *cardDAVService) deleteCollection(p string, conditions *DAVConditions) error {
	return s.store.DeleteAddressBook(p, conditions)
}

func (s *cardDAVService) putObject(p string, body []byte, conditions *DAVConditions) (*davObject, bool, error) {
	card, err := vcard.NewDecoder(bytes.NewReader(body)).Decode()
	if err != nil {
		return nil, false, cardDAVPrecondition("valid-address-data")
	}
	object, created, err := s.store.PutAddressObject(p, card, conditions)
	if err != nil {
		return nil, false, davError(err, cardDavWriteErrorCodes)
	}
	return addressDAVObject(object), created, nil
}

func (s *cardDAVService) deleteObject(p string, conditions *DAVConditions) error {
	return davError(s.store.DeleteAddressObject(p, conditions), cardDavReadErrorCodes)
}

func (s *cardDAVService) dataRenderer(node *dav.Node, _ *time.Location) (davDataRenderer, error) {
	request, err := dav.ParseAddressDataRequest(node)
	if err != nil {
		return nil, err
	}
	return func(object *davObject) (string, error) {
		if request.Full() {
			return string(object.content), nil
		}
		var buf bytes.Buffer
		if err := vcard.NewEncoder(&buf).Encode(request.Select(object.card)); err != nil {
			return "", err
		}
		return buf.String(), nil
	}, nil
}

func (s *cardDAVService) report(h *davHandler, w http.ResponseWriter, r *http.Request, target *davResource, root *dav.Node) (bool, error) {
	if dav.CardDAVName("addressbook-query") != root.XMLName {
		return false, nil
	}
	return true, s.query(h, w, r, target, root)
}

// query 处理 CARDDAV:addressbook-query（RFC 6352 §8.6）。没有 Depth 头时按 0 处理；结果超过 limit 时截断，
// 并为请求地址返回 507 与 DAV:number-of-matches-within-limits。
func (s *cardDAVService) query(h *davHandler, w http.ResponseWriter, r *http.Request, target *davResource, root *dav.Node) error {
	depth, err := dav.ParseDepth(r.Header.Get("Depth"), dav.DepthZero)
	if err != nil {
		return err
	}
	filter, err := dav.ParseAddressFilter(root.Child(dav.CardDAVName("filter")))
	if err != nil {
		return err
	}
	limit := 0
	if node := root.Child(dav.CardDAVName("limit")); nil != node {
		results := node.Child(dav.CardDAVName("nresults"))
		if nil == results {
			return dav.NewError(http.StatusBadRequest, errors.New("CardDAV: limit requires nresults"))
		}
		if limit, err = strconv.Atoi(strings.TrimSpace(results.Text())); err != nil || limit <= 0 {
			return dav.NewError(http.StatusBadRequest, errors.New("CardDAV: nresults must be a positive integer"))
		}
	}
	request, err := h.parsePropRequest(root, nil, true)
	if err != nil {
		return err
	}
	var responses []*dav.Response
	for _, object := range h.objectsInScope(target, depth) {
		if !filter.Match(object.object.card) {
			continue
		}
		if 0 < limit && limit == len(responses) {
			responses = append(responses, &dav.Response{Href: target.hrefPath(), Status: http.StatusInsufficientStorage,
				Error: dav.NewElement(dav.DAVName("number-of-matches-within-limits"))})
			break
		}
		responses = append(responses, h.propResponse(object, request))
	}
	return dav.WriteMultistatus(w, responses)
}
