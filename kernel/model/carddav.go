// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/emersion/go-vcard"
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
)

// ImportVCardFile imports a address book from a vCard file (*.vcf)
func ImportAddressBook(addressBookPath, cardContent string) (addresses []*AddressObject, err error) {
	// TODO: Check whether the path is valid (PathDepth: Address)
	// TODO: Check whether the address book exists
	// TODO: Decode the card content
	// TODO: Save the cards to the file system
	return
}

// ExportAddressBook exports a address book to a vCard file (*.vcf)
func ExportAddressBook(addressBookPath string) (cardContent string, err error) {
	// TODO: Check whether the path is valid (PathDepth: AddressBook)
	// TODO: Check whether the address book exists
	// TODO: Encode the card content
	return
}

// AddressBooksMetaDataFilePath returns the absolute path of the address books meta data file
func AddressBooksMetaDataFilePath() string {
	return DavPath2DirectoryPath(CardDavAddressBooksMetaDataFilePath)
}

func GetCardDavPathDepth(urlPath string) CardDavPathDepth {
	urlPath = PathCleanWithSlash(urlPath)
	return CardDavPathDepth(len(strings.Split(urlPath, "/")) - 1)
}

// ParseAddressPath parses address path to address book path and address ID
func ParseAddressPath(addressPath string) (addressBookPath string, addressID string, err error) {
	addressBookPath, addressFileName := path.Split(addressPath)
	addressID = path.Base(addressFileName)
	addressFileExt := util.Ext(addressFileName)

	if GetCardDavPathDepth(addressBookPath) != cardDavPathDepth_AddressBook {
		err = ErrorCardDavBookPathInvalid
		return
	}

	if addressFileExt != VCardFileExt {
		err = ErrorCardDavAddressFileExtensionNameInvalid
		return
	}

	return
}

// AddressPropsFilter filters address properties
func AddressPropsFilter(address *carddav.AddressObject, req *carddav.AddressDataRequest) *carddav.AddressObject {
	var card *vcard.Card
	card = &address.Card

	// if req.AllProp {
	// 	card = &address.Card
	// } else {
	// 	card = &vcard.Card{}
	// 	for _, prop := range req.Props {
	// 		fields := address.Card[prop]
	// 		if fields != nil {
	// 			for _, field := range fields {
	// 				card.Add(prop, field)
	// 			}
	// 		}
	// 	}
	// }

	return &carddav.AddressObject{
		Path:          address.Path,
		ModTime:       address.ModTime,
		ContentLength: address.ContentLength,
		ETag:          address.ETag,
		Card:          *card,
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
	wg := &sync.WaitGroup{}
	wg.Add(len(c.booksMetaData))
	for _, addressBookMetaData := range c.booksMetaData {
		addressBook := &AddressBook{
			Changed:       false,
			DirectoryPath: DavPath2DirectoryPath(addressBookMetaData.Path),
			MetaData:      addressBookMetaData,
			Addresses:     sync.Map{},
		}
		c.books.Store(addressBookMetaData.Path, addressBook)
		go func() {
			defer wg.Done()
			addressBook.load()
		}()
	}
	wg.Wait()

	c.loaded = true
	c.changed = false
	return nil
}

// save all contacts
func (c *Contacts) save(force bool) error {
	if force || c.changed {
		// save address books meta data
		if err := c.saveAddressBooksMetaData(); err != nil {
			return err
		}

		// save all address to *.vbf files
		wg := &sync.WaitGroup{}
		c.books.Range(func(path any, book any) bool {
			wg.Add(1)
			go func() {
				defer wg.Done()
				// path_ := path.(string)
				book_ := book.(*AddressBook)
				book_.save(force)
			}()
			return true
		})
		wg.Wait()
		c.changed = false
	}
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

func (c *Contacts) DeleteAddress(addressPath string) (addressBook *AddressBook, addressObject *AddressObject, err error) {
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

	if value, loaded := addressBook.Addresses.LoadAndDelete(addressID); loaded {
		addressObject = value.(*AddressObject)
	} else {
		err = ErrorCardDavAddressNotFound
		return
	}

	if err = os.Remove(addressObject.FilePath); err != nil {
		logging.LogErrorf("remove file [%s] failed: %s", addressObject.FilePath, err)
		return
	}

	return
}

func (c *Contacts) ListAddressBooks() (addressBooks []carddav.AddressBook, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	for _, addressBook := range contacts.booksMetaData {
		addressBooks = append(addressBooks, *addressBook)
	}
	return
}

func (c *Contacts) GetAddressBook(path string) (addressBook *carddav.AddressBook, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	if book, ok := contacts.books.Load(path); ok {
		addressBook = book.(*AddressBook).MetaData
		return
	}

	err = ErrorCardDavBookNotFound
	return
}

func (c *Contacts) CreateAddressBook(addressBookMetaData *carddav.AddressBook) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	var addressBook *AddressBook

	// update map
	if value, ok := c.books.Load(addressBookMetaData.Path); ok {
		// update map item
		addressBook = value.(*AddressBook)
		addressBook.MetaData = addressBookMetaData
	} else {
		// insert map item
		addressBook = &AddressBook{
			Changed:       false,
			DirectoryPath: DavPath2DirectoryPath(addressBookMetaData.Path),
			MetaData:      addressBookMetaData,
			Addresses:     sync.Map{},
		}
		c.books.Store(addressBookMetaData.Path, addressBook)
	}

	var index = -1
	for i, item := range c.booksMetaData {
		if item.Path == addressBookMetaData.Path {
			index = i
			break
		}
	}

	if index >= 0 {
		// update list
		c.booksMetaData[index] = addressBookMetaData
	} else {
		// insert list
		c.booksMetaData = append(c.booksMetaData, addressBookMetaData)
	}

	// create address book directory
	if err = os.MkdirAll(addressBook.DirectoryPath, 0755); err != nil {
		logging.LogErrorf("create directory [%s] failed: %s", addressBook.DirectoryPath, err)
		return
	}

	// save meta data
	if err = c.saveAddressBooksMetaData(); err != nil {
		return
	}

	return
}

func (c *Contacts) DeleteAddressBook(path string) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	var addressBook *AddressBook

	// delete map item
	if value, loaded := c.books.LoadAndDelete(path); loaded {
		addressBook = value.(*AddressBook)
	}

	// delete list item
	for i, item := range c.booksMetaData {
		if item.Path == path {
			c.booksMetaData = append(c.booksMetaData[:i], c.booksMetaData[i+1:]...)
			break
		}
	}

	// remove address book directory
	if err = os.RemoveAll(addressBook.DirectoryPath); err != nil {
		logging.LogErrorf("remove directory [%s] failed: %s", addressBook.DirectoryPath, err)
		return
	}

	// save meta data
	if err = c.saveAddressBooksMetaData(); err != nil {
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

	// TODO: 处理 opts.IfNoneMatch (If-None-Match) 与 opts.IfMatch (If-Match)

	var address *AddressObject
	if value, ok := addressBook.Addresses.Load(addressID); ok {
		address = value.(*AddressObject)
		address.Data.Card = card
		address.Changed = true
	} else {
		address = &AddressObject{
			Changed:  true,
			FilePath: DavPath2DirectoryPath(addressPath),
			BookPath: bookPath,
			Data: &carddav.AddressObject{
				Card: card,
			},
		}
	}

	err = address.save(true)
	if err != nil {
		return
	}

	err = address.update()
	if err != nil {
		return
	}

	addressBook.Addresses.Store(addressID, address)
	addressObject = address.Data
	return
}

func (c *Contacts) DeleteAddressObject(addressPath string) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	_, _, err = c.DeleteAddress(addressPath)
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

	wg := &sync.WaitGroup{}
	for _, entry := range entries {
		if !entry.IsDir() {
			filename := entry.Name()
			ext := util.Ext(filename)
			if ext == VCardFileExt {
				wg.Add(1)
				go func() {
					defer wg.Done()

					// load cards
					addressFilePath := path.Join(b.DirectoryPath, filename)
					vCards, err := LoadCards(addressFilePath)
					if err != nil {
						return
					}

					switch len(vCards) {
					case 0: // invalid file
					case 1: // file contain 1 card
						address := &AddressObject{
							FilePath: addressFilePath,
							BookPath: b.MetaData.Path,
							Data: &carddav.AddressObject{
								Card: *vCards[0],
							},
						}
						if err := address.update(); err != nil {
							return
						}

						id := path.Base(filename)
						b.Addresses.Store(id, address)
					default: // file contain multiple cards
						// Create a file for each card
						addressesWaitGroup := &sync.WaitGroup{}
						for _, vCard := range vCards {
							addressesWaitGroup.Add(1)
							go func() {
								defer addressesWaitGroup.Done()
								filename_ := util.AssetName(filename, ast.NewNodeID())
								address := &AddressObject{
									FilePath: path.Join(b.DirectoryPath, filename_),
									BookPath: b.MetaData.Path,
									Data: &carddav.AddressObject{
										Card: *vCard,
									},
								}
								if err := address.save(true); err != nil {
									return
								}
								if err := address.update(); err != nil {
									return
								}

								id := path.Base(filename)
								b.Addresses.Store(id, address)
							}()
						}

						addressesWaitGroup.Wait()
						// Delete original file with multiple cards
						if err := os.Remove(addressFilePath); err != nil {
							logging.LogErrorf("remove file [%s] failed: %s", addressFilePath, err)
							return
						}
					}
				}()
			}
		}
	}
	wg.Wait()
	return nil
}

// save an address book to multiple *.vcf files
func (b *AddressBook) save(force bool) error {
	if force || b.Changed {
		// create directory
		if err := os.MkdirAll(b.DirectoryPath, 0755); err != nil {
			logging.LogErrorf("create directory [%s] failed: %s", b.DirectoryPath, err)
			return err
		}

		wg := &sync.WaitGroup{}
		b.Addresses.Range(func(id any, address any) bool {
			wg.Add(1)
			go func() {
				defer wg.Done()
				// id_ := id.(string)
				address_ := address.(*AddressObject)
				address_.save(force)
				address_.update()
			}()
			return true
		})
		wg.Wait()
		b.Changed = false
	}

	return nil
}

type AddressObject struct {
	Changed  bool
	FilePath string
	BookPath string
	Data     *carddav.AddressObject
}

// load an address from *.vcf file
func (o *AddressObject) load() error {
	// load vCard file
	cards, err := LoadCards(o.FilePath)
	if err != nil {
		return err
	}
	if len(cards) != 1 {
		return fmt.Errorf("file [%s] contains multiple cards", o.FilePath)
	}

	// create address object
	o.Data = &carddav.AddressObject{
		Card: *cards[0],
	}

	// update file info
	err = o.update()
	if err != nil {
		return err
	}

	o.Changed = false
	return nil
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
		if err := os.WriteFile(o.FilePath, addressData.Bytes(), 0755); err != nil {
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

	o.Data.Path = PathJoinWithSlash(o.BookPath, addressFileInfo.Name())
	o.Data.ModTime = addressFileInfo.ModTime()
	o.Data.ContentLength = addressFileInfo.Size()
	o.Data.ETag = FileETag(addressFileInfo)

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

	err = contacts.DeleteAddressBook(bookPath)
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
	// logging.LogDebugf("CardDAV PutAddressObject <- addressObject: %#v, err: %s", addressObject, err)
	return
}

func (b *CardDavBackend) DeleteAddressObject(ctx context.Context, addressPath string) (err error) {
	// logging.LogDebugf("CardDAV DeleteAddressObject -> addressPath: %s", addressPath)
	addressPath = PathCleanWithSlash(addressPath)

	if err = contacts.Load(); err != nil {
		return
	}

	err = contacts.DeleteAddressObject(addressPath)
	// logging.LogDebugf("CardDAV DeleteAddressObject <- err: %s", err)
	return
}
