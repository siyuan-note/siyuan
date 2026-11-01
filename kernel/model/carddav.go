// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"golang.org/x/sync/errgroup"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/emersion/go-vcard"
	"github.com/emersion/go-webdav"
	"github.com/emersion/go-webdav/carddav"
	"github.com/siyuan-note/logging"
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

	CardDavAddressBooksMetaDataFilePath = CardDavHomeSetPath + "/address-books.json"

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

var (
	addressBookMaxResourceSize      int64 = 0
	addressBookSupportedAddressData       = []carddav.AddressDataType{
		{
			ContentType: vcard.MIMEType,
			Version:     "3.0",
		},
		{
			ContentType: vcard.MIMEType,
			Version:     "4.0",
		},
	}

	defaultAddressBook = carddav.AddressBook{
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
		booksMetaData: []*carddav.AddressBook{},
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

// AddressPropsFilter 按 address-data 请求只保留列出的属性（RFC 6352 §10.4.2），并保留 VERSION 使结果仍是合法的 vCard。
func AddressPropsFilter(address *carddav.AddressObject, req *carddav.AddressDataRequest) *carddav.AddressObject {
	card := address.Card
	if nil != req && !req.AllProp && 0 < len(req.Props) {
		card = vcard.Card{vcard.FieldVersion: address.Card[vcard.FieldVersion]}
		for _, prop := range req.Props {
			if fields, ok := address.Card[strings.ToUpper(prop)]; ok {
				card[strings.ToUpper(prop)] = fields
			}
		}
	}

	return &carddav.AddressObject{
		Path:          address.Path,
		ModTime:       address.ModTime,
		ContentLength: address.ContentLength,
		ETag:          address.ETag,
		Card:          card,
	}
}

func LoadCards(filePath string) (cards []*vcard.Card, err error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		logging.LogErrorf("read vCard file [%s] failed: %s", filePath, err)
		return
	}

	decoder := vcard.NewDecoder(bytes.NewReader(data))
	for {
		card, err := decoder.Decode()
		if err != nil {
			if err == io.EOF {
				break
			}
			logging.LogErrorf("decode vCard file [%s] failed: %s", filePath, err)
			return nil, err
		}
		cards = append(cards, &card)
	}

	return
}

type Contacts struct {
	loaded        bool
	changed       bool
	lock          sync.Mutex // load & save
	books         sync.Map   // Path -> *AddressBook
	booksMetaData []*carddav.AddressBook
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
		c.booksMetaData = []*carddav.AddressBook{&defaultAddressBook}
		if err := c.saveAddressBooksMetaData(); err != nil {
			return err
		}
	} else {
		// load meta data file
		c.booksMetaData = []*carddav.AddressBook{}
		if err = gulu.JSON.UnmarshalJSON(metaData, &c.booksMetaData); err != nil {
			logging.LogErrorf("unmarshal address books meta data failed: %s", err)
			return err
		}
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
		logging.LogErrorf("parse address path [%s] failed: %s", addressPath, err)
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

func (c *Contacts) ListAddressBooks() (addressBooks []carddav.AddressBook, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	for _, addressBook := range c.booksMetaData {
		addressBooks = append(addressBooks, *addressBook)
	}
	return
}

func (c *Contacts) GetAddressBook(path string) (addressBook *carddav.AddressBook, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	if book, ok := c.books.Load(path); ok {
		addressBook = book.(*AddressBook).MetaData
		return
	}

	err = ErrorCardDavBookNotFound
	return
}

// CreateAddressBook 在 home set 下创建新通讯录；RFC 4918 §9.3 要求 MKCOL 不能作用于已存在的资源，失败时恢复原状态。
func (c *Contacts) CreateAddressBook(addressBookMetaData *carddav.AddressBook) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	if !isCardDavAddressBookPath(addressBookMetaData.Path) {
		return carddav.NewPreconditionError("addressbook-collection-location-ok")
	}
	if _, ok := c.books.Load(addressBookMetaData.Path); ok {
		return webdav.NewHTTPError(http.StatusMethodNotAllowed, ErrorCardDavBookExists)
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
	if err = c.saveAddressBooksMetaData(); err != nil {
		c.books.Delete(addressBookMetaData.Path)
		c.booksMetaData = c.booksMetaData[:len(c.booksMetaData)-1]
		if createdDirectory {
			_ = os.Remove(addressBook.DirectoryPath)
		}
		return
	}
	return
}

func (c *Contacts) DeleteAddressBook(path string, conditions *DAVConditions) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	value, ok := c.books.Load(path)
	if !ok {
		return webdav.NewHTTPError(http.StatusNotFound, ErrorCardDavBookNotFound)
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

	return nil
}

func (c *Contacts) GetAddressObject(addressPath string, req *carddav.AddressDataRequest) (addressObject *carddav.AddressObject, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	_, address, err := c.GetAddress(addressPath)
	if err != nil {
		return
	}

	addressObject = AddressPropsFilter(address.Data, req)
	return
}

func (c *Contacts) ListAddressObjects(bookPath string, req *carddav.AddressDataRequest) (addressObjects []carddav.AddressObject, err error) {
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
		addressObjects = append(addressObjects, *AddressPropsFilter(address.(*AddressObject).Data, req))
		return true
	})

	return
}

func (c *Contacts) QueryAddressObjects(urlPath string, query *carddav.AddressBookQuery) (addressObjects []carddav.AddressObject, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	switch GetCardDavPathDepth(urlPath) {
	case cardDavPathDepth_Root, cardDavPathDepth_Principals, cardDavPathDepth_UserPrincipal, cardDavPathDepth_HomeSet:
		c.books.Range(func(path any, book any) bool {
			addressBook := book.(*AddressBook)
			addressBook.Addresses.Range(func(id any, address any) bool {
				addressObjects = append(addressObjects, *address.(*AddressObject).Data)
				return true
			})
			return true
		})
	case cardDavPathDepth_AddressBook:
		if value, ok := c.books.Load(urlPath); ok {
			addressBook := value.(*AddressBook)
			addressBook.Addresses.Range(func(id any, address any) bool {
				addressObjects = append(addressObjects, *address.(*AddressObject).Data)
				return true
			})
		}
	case cardDavPathDepth_Address:
		if _, address, _ := c.GetAddress(urlPath); address != nil {
			addressObjects = append(addressObjects, *address.Data)
		}
	default:
		err = ErrorCardDavPathInvalid
		return
	}

	addressObjects, err = carddav.Filter(query, addressObjects)
	return
}

func (c *Contacts) PutAddressObject(addressPath string, card vcard.Card, opts *carddav.PutAddressObjectOptions) (addressObject *carddav.AddressObject, err error) {
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

	if opts != nil {
		etag := ""
		if value, ok := addressBook.Addresses.Load(addressID); ok {
			etag = value.(*AddressObject).Data.ETag
		}
		if err = checkDAVConditions(etag, opts.IfMatch, opts.IfNoneMatch); err != nil {
			return
		}
	}

	if err = addressBook.validateAddress(addressID, card); err != nil {
		return
	}

	// Do not mutate a cached object until its replacement is persisted.
	address := &AddressObject{
		Changed:  true,
		FilePath: DavPath2DirectoryPath(addressPath),
		BookPath: bookPath,
		Data: &carddav.AddressObject{
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
	addressObject = address.Data
	return
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
	MetaData      *carddav.AddressBook
	Addresses     sync.Map // id -> *AddressObject
}

// validateAddress 检查 RFC 6352 §6.3.2.1 对新写入联系人的前置条件；已有数据不受影响，只校验本次写入。
func (b *AddressBook) validateAddress(addressID string, card vcard.Card) error {
	if err := vcard.NewEncoder(io.Discard).Encode(card); err != nil {
		return carddav.NewPreconditionError(carddav.PreconditionValidAddressData)
	}

	// vCard 3.0 的 UID 是可选属性，没有 UID 的联系人不参与冲突检查
	uid := card.Value(vcard.FieldUID)
	conflict := false
	b.Addresses.Range(func(id any, value any) bool {
		existingUID := value.(*AddressObject).Data.Card.Value(vcard.FieldUID)
		if id.(string) == addressID {
			conflict = "" != existingUID && existingUID != uid
		} else {
			conflict = "" != uid && existingUID == uid
		}
		return !conflict
	})
	if conflict {
		return carddav.NewPreconditionError(carddav.PreconditionNoUIDConflict)
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
					vCards, err := LoadCards(addressFilePath)
					if err != nil {
						return err
					}

					switch len(vCards) {
					case 0: // invalid file
						return errors.New("CardDAV: no card in persisted file")
					case 1: // file contain 1 card
						address := &AddressObject{
							FilePath: addressFilePath,
							BookPath: b.MetaData.Path,
							Data: &carddav.AddressObject{
								Card: *vCards[0],
							},
						}
						if err := address.update(); err != nil {
							return err
						}
						// 响应体是重新编码的数据，同步或手工放入的文件不一定是规范编码；无法编码时不声明长度
						var lengthErr error
						if address.Data.ContentLength, lengthErr = davEncodedLength(func(w io.Writer) error { return vcard.NewEncoder(w).Encode(address.Data.Card) }); lengthErr != nil {
							logging.LogWarnf("encode card [%s] failed: %s", addressFilePath, lengthErr)
							address.Data.ContentLength = 0
						}

						id := path.Base(filename)
						b.Addresses.Store(id, address)
					default: // file contain multiple cards
						// Create a file for each card
						addressesWaitGroup := &errgroup.Group{}
						for _, vCard := range vCards {
							addressesWaitGroup.Go(func() error {
								// 文件名由卡片内容决定：多台设备同步前各自拆分同一文件时得到同名同内容的文件，同步后不会重复
								var encoded bytes.Buffer
								if err := vcard.NewEncoder(&encoded).Encode(*vCard); err != nil {
									return err
								}
								sum := sha256.Sum256(encoded.Bytes())
								filename_ := strings.TrimSuffix(filename, VCardFileExt) + "-" + hex.EncodeToString(sum[:8]) + VCardFileExt
								address := &AddressObject{
									FilePath: path.Join(b.DirectoryPath, filename_),
									BookPath: b.MetaData.Path,
									Data: &carddav.AddressObject{
										Card: *vCard,
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
	Data     *carddav.AddressObject
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

// update file info
func (o *AddressObject) update() error {
	addressFileInfo, err := os.Stat(o.FilePath)
	if err != nil {
		logging.LogErrorf("get file [%s] info failed: %s", o.FilePath, err)
		return err
	}

	etag, err := FileETag(o.FilePath)
	if err != nil {
		return err
	}
	o.Data.Path = PathJoinWithSlash(o.BookPath, addressFileInfo.Name())
	o.Data.ModTime = addressFileInfo.ModTime()
	o.Data.ContentLength = addressFileInfo.Size()
	o.Data.ETag = etag

	return nil
}

type CardDavBackend struct{}

func (b *CardDavBackend) CurrentUserPrincipal(ctx context.Context) (string, error) {
	// logging.LogDebugf("CardDAV CurrentUserPrincipal")
	return CardDavUserPrincipalPath, nil
}

func (b *CardDavBackend) AddressBookHomeSetPath(ctx context.Context) (string, error) {
	// logging.LogDebugf("CardDAV AddressBookHomeSetPath")
	return CardDavHomeSetPath, nil
}

func (b *CardDavBackend) ListAddressBooks(ctx context.Context) (addressBooks []carddav.AddressBook, err error) {
	// logging.LogDebugf("CardDAV ListAddressBooks")
	if err = contacts.Load(); err != nil {
		return
	}

	addressBooks, err = contacts.ListAddressBooks()
	// logging.LogDebugf("CardDAV ListAddressBooks <- addressBooks: %#v, err: %s", addressBooks, err)
	return
}

func (b *CardDavBackend) GetAddressBook(ctx context.Context, bookPath string) (addressBook *carddav.AddressBook, err error) {
	// logging.LogDebugf("CardDAV GetAddressBook -> bookPath: %s", bookPath)
	bookPath = PathCleanWithSlash(bookPath)

	if err = contacts.Load(); err != nil {
		return
	}

	addressBook, err = contacts.GetAddressBook(bookPath)
	err = davError(err, cardDavReadErrorCodes)
	// logging.LogDebugf("CardDAV GetAddressBook <- addressBook: %#v, err: %s", addressBook, err)
	return
}

func (b *CardDavBackend) CreateAddressBook(ctx context.Context, addressBook *carddav.AddressBook) (err error) {
	// logging.LogDebugf("CardDAV CreateAddressBook -> addressBook: %#v", addressBook)
	addressBook.Path = PathCleanWithSlash(addressBook.Path)

	if err = contacts.Load(); err != nil {
		return
	}

	err = contacts.CreateAddressBook(addressBook)
	// logging.LogDebugf("CardDAV CreateAddressBook <- err: %s", err)
	return
}

func (b *CardDavBackend) DeleteAddressBook(ctx context.Context, bookPath string) (err error) {
	// logging.LogDebugf("CardDAV DeleteAddressBook -> bookPath: %s", bookPath)
	bookPath = PathCleanWithSlash(bookPath)

	if err = contacts.Load(); err != nil {
		return
	}

	err = contacts.DeleteAddressBook(bookPath, davConditionsFromContext(ctx))
	// logging.LogDebugf("CardDAV DeleteAddressBook <- err: %s", err)
	return
}

func (b *CardDavBackend) GetAddressObject(ctx context.Context, addressPath string, req *carddav.AddressDataRequest) (addressObject *carddav.AddressObject, err error) {
	// logging.LogDebugf("CardDAV GetAddressObject -> addressPath: %s, req: %#v", addressPath, req)
	addressPath = PathCleanWithSlash(addressPath)

	if err = contacts.Load(); err != nil {
		return
	}

	addressObject, err = contacts.GetAddressObject(addressPath, req)
	err = davError(err, cardDavReadErrorCodes)
	// logging.LogDebugf("CardDAV GetAddressObject <- addressObject: %#v, err: %s", addressObject, err)
	return
}

func (b *CardDavBackend) ListAddressObjects(ctx context.Context, bookPath string, req *carddav.AddressDataRequest) (addressObjects []carddav.AddressObject, err error) {
	// logging.LogDebugf("CardDAV ListAddressObjects -> bookPath: %s, req: %#v", bookPath, req)
	bookPath = PathCleanWithSlash(bookPath)

	if err = contacts.Load(); err != nil {
		return
	}

	addressObjects, err = contacts.ListAddressObjects(bookPath, req)
	err = davError(err, cardDavReadErrorCodes)
	// logging.LogDebugf("CardDAV ListAddressObjects <- addressObjects: %#v, err: %s", addressObjects, err)
	return
}

func (b *CardDavBackend) QueryAddressObjects(ctx context.Context, urlPath string, query *carddav.AddressBookQuery) (addressObjects []carddav.AddressObject, err error) {
	// logging.LogDebugf("CardDAV QueryAddressObjects -> urlPath: %s, query: %#v", urlPath, query)
	urlPath = PathCleanWithSlash(urlPath)

	if err = contacts.Load(); err != nil {
		return
	}

	addressObjects, err = contacts.QueryAddressObjects(urlPath, query)
	err = davError(err, cardDavReadErrorCodes)
	// logging.LogDebugf("CardDAV QueryAddressObjects <- addressObjects: %#v, err: %s", addressObjects, err)
	return
}

func (b *CardDavBackend) PutAddressObject(ctx context.Context, addressPath string, card vcard.Card, opts *carddav.PutAddressObjectOptions) (addressObject *carddav.AddressObject, err error) {
	// logging.LogDebugf("CardDAV PutAddressObject -> addressPath: %s, card: %#v, opts: %#v", addressPath, card, opts)
	addressPath = PathCleanWithSlash(addressPath)

	if err = contacts.Load(); err != nil {
		return
	}

	addressObject, err = contacts.PutAddressObject(addressPath, card, opts)
	if err != nil {
		return nil, davError(err, cardDavWriteErrorCodes)
	}
	// logging.LogDebugf("CardDAV PutAddressObject <- addressObject: %#v, err: %s", addressObject, err)
	return addressObjectForPutResponse(ctx, addressObject), nil
}

// addressObjectForPutResponse 在存储内容与提交内容不是同一字节序列时去掉 ETag，
// RFC 6352 §6.3.2.3 不允许此时在 PUT 响应中返回强 ETag，客户端需要重新获取。
func addressObjectForPutResponse(ctx context.Context, addressObject *carddav.AddressObject) *carddav.AddressObject {
	request := davRequestFromContext(ctx)
	if nil == request || nil == request.Body {
		return addressObject
	}
	var stored bytes.Buffer
	if err := vcard.NewEncoder(&stored).Encode(addressObject.Card); err == nil && bytes.Equal(stored.Bytes(), request.Body) {
		return addressObject
	}
	response := *addressObject
	response.ETag = ""
	return &response
}

func (b *CardDavBackend) DeleteAddressObject(ctx context.Context, addressPath string) (err error) {
	// logging.LogDebugf("CardDAV DeleteAddressObject -> addressPath: %s", addressPath)
	addressPath = PathCleanWithSlash(addressPath)

	if err = contacts.Load(); err != nil {
		return
	}

	err = contacts.DeleteAddressObject(addressPath, davConditionsFromContext(ctx))
	err = davError(err, cardDavReadErrorCodes)
	// logging.LogDebugf("CardDAV DeleteAddressObject <- err: %s", err)
	return
}
