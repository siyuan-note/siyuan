<p align="center">
<img alt="SiYuan" src="https://b3log.org/images/brand/siyuan-128.png">
<br>
<em>Düşünceni Yeniden Şekillendir</em>
<br><br>
<a title="Derleme Durumu" target="_blank" href="https://github.com/siyuan-note/siyuan/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/siyuan-note/siyuan/cd.yml?style=flat-square"></a>
<a title="Sürümler" target="_blank" href="https://github.com/siyuan-note/siyuan/releases"><img src="https://img.shields.io/github/release/siyuan-note/siyuan.svg?style=flat-square&color=9CF"></a>
<a title="İndirme Sayısı" target="_blank" href="https://github.com/siyuan-note/siyuan/releases"><img src="https://img.shields.io/github/downloads/siyuan-note/siyuan/total.svg?style=flat-square&color=blueviolet"></a>
<br>
<a title="Docker Çekimleri" target="_blank" href="https://hub.docker.com/r/b3log/siyuan"><img src="https://img.shields.io/docker/pulls/b3log/siyuan.svg?style=flat-square&color=green"></a>
<a title="Docker Görüntü Boyutu" target="_blank" href="https://hub.docker.com/r/b3log/siyuan"><img src="https://img.shields.io/docker/image-size/b3log/siyuan.svg?style=flat-square&color=ff96b4"></a>
<a title="Görüntülenme Sayısı" target="_blank" href="https://github.com/siyuan-note/siyuan"><img src="https://hits.b3log.org/siyuan-note/siyuan.svg"></a>
<br>
<a title="AGPLv3" target="_blank" href="https://www.gnu.org/licenses/agpl-3.0.txt"><img src="http://img.shields.io/badge/license-AGPLv3-orange.svg?style=flat-square"></a>
<a title="Kod Boyutu" target="_blank" href="https://github.com/siyuan-note/siyuan"><img src="https://img.shields.io/github/languages/code-size/siyuan-note/siyuan.svg?style=flat-square&color=yellow"></a>
<a title="GitHub Pull İstekleri" target="_blank" href="https://github.com/siyuan-note/siyuan/pulls"><img src="https://img.shields.io/github/issues-pr-closed/siyuan-note/siyuan.svg?style=flat-square&color=FF9966"></a>
<br>
<a title="GitHub Commit'leri" target="_blank" href="https://github.com/siyuan-note/siyuan/commits/master"><img src="https://img.shields.io/github/commit-activity/m/siyuan-note/siyuan.svg?style=flat-square"></a>
<a title="Son Commit" target="_blank" href="https://github.com/siyuan-note/siyuan/commits/master"><img src="https://img.shields.io/github/last-commit/siyuan-note/siyuan.svg?style=flat-square&color=FF9900"></a>
<br><br>
<a title="Twitter" target="_blank" href="https://twitter.com/b3logos"><img alt="Twitter Takip" src="https://img.shields.io/twitter/follow/b3logos?label=Takip%20Et&style=social"></a>
<a title="Discord" target="_blank" href="https://discord.gg/dmMbCqVX7G"><img alt="Discord'da Sohbet Et" src="https://img.shields.io/discord/808152298789666826?label=Discord&logo=Discord&style=social"></a>
<br><br>
<a href="https://trendshift.io/repositories/3949" target="_blank"><img src="https://trendshift.io/api/badge/repositories/3949" alt="siyuan-note%2Fsiyuan | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
<a href="README.md">English</a>
| <a href="README_zh_CN.md">中文</a>
| <a href="README_ja_JP.md">日本語</a>
| <b>Türkçe</b>
</p>

---

## İçindekiler

* [💡 Giriş](#-giriş)
* [🔮 Özellikler](#-özellikler)
* [🏗️ Mimari ve Ekosistem](#-mimari-ve-ekosistem)
* [🌟 Yıldız Geçmişi](#-yıldız-geçmişi)
* [🗺️ Yol Haritası](#️-yol-haritası)
* [🚀 İndirme ve Kurulum](#-indirme-ve-kurulum)
  * [Uygulama Mağazası](#uygulama-mağazası)
  * [Kurulum Paketi](#kurulum-paketi)
  * [Paket Yöneticisi](#paket-yöneticisi)
  * [Docker Barındırma](#docker-barındırma)
  * [Unraid Barındırma](#unraid-barındırma)
  * [TrueNAS Barındırma](#truenas-barındırma)
  * [Erken Önizleme (Insider Preview)](#erken-önizleme-insider-preview)
* [🏘️ Topluluk](#️-topluluk)
* [🛠️ Geliştirme Rehberi](#️-geliştirme-rehberi)
* [❓ SSS (Sıkça Sorulan Sorular)](#-sss-sıkça-sorulan-sorular)
  * [SiYuan verileri nasıl saklar?](#siyuan-verileri-nasıl-saklar)
  * [Üçüncü taraf senkronizasyon diskiyle veri senkronizasyonu destekleniyor mu?](#üçüncü-taraf-senkronizasyon-diskiyle-veri-senkronizasyonu-destekleniyor-mu)
  * [SiYuan açık kaynak mı?](#siyuan-açık-kaynak-mı)
  * [Yeni bir sürüme nasıl yükseltilir?](#yeni-bir-sürüme-nasıl-yükseltilir)
  * [Bazı bloklar (örneğin liste öğelerindeki paragraflar) blok simgesini bulamıyorsa ne yapmalıyım?](#bazı-bloklar-örneğin-liste-öğelerindeki-paragraflar-blok-simgesini-bulamıyorsa-ne-yapmalıyım)
  * [Veri deposu anahtarı (data repo key) kaybolursa ne yapmalıyım?](#veri-deposu-anahtarı-data-repo-key-kaybolursa-ne-yapmalıyım)
  * [Ücretli mi?](#ücretli-mi)
* [🙏 Teşekkür](#-teşekkür)
  * [Katkıda Bulunanlar](#katkıda-bulunanlar)

---

## 💡 Giriş

SiYuan, gizliliği ön planda tutan kişisel bir bilgi yönetim sistemidir.  
Blok düzeyinde referansları ve Markdown WYSIWYG düzenlemeyi destekler.

Daha fazla bilgi için [SiYuan İngilizce Tartışma Forumu](https://liuyun.io)’na katılabilirsin.

![feature0.png](https://b3logfile.com/file/2025/11/feature0-GfbhEqf.png)

![feature51.png](https://b3logfile.com/file/2025/11/feature5-1-7DJSfEP.png)

## 🔮 Özellikler

Çoğu özellik tamamen ücretsizdir ve ticari kullanım için de geçerlidir.

* İçerik Bloğu
  * Blok düzeyinde referans ve çift yönlü bağlantılar
  * Özel nitelikler
  * Gömülü SQL sorgusu
  * `siyuan://` protokolü
* Editör
  * Blok tabanlı yapı
  * Markdown WYSIWYG düzenleme
  * Liste taslağı görünümü
  * Blok yakınlaştırma (zoom-in)
  * Milyon kelimelik büyük belge düzenleme
  * Matematiksel formüller, grafikler, akış diyagramları, Gantt diyagramları, zaman diyagramları, notalar vb.
  * Web kırpma (web clipping)
  * PDF açıklama bağlantısı
* Dışa Aktarım
  * Blok referansı ve gömme desteği
  * Varlıklarıyla birlikte standart Markdown çıktısı
  * PDF, Word ve HTML olarak dışa aktarma
  * WeChat MP, Zhihu ve Yuque’a kopyalama
* Veritabanı
  * Tablo görünümü
* Aralıklı Tekrar (Flashcard)
* OpenAI API ile yapay zekâ yazma ve Soru-Cevap sohbeti
* Tesseract OCR
* Çok sekmeli görünüm, sürükle-bırak ile ekran bölme
* Şablon parçacıkları
* JavaScript/CSS kod parçacıkları
* Android / iOS / HarmonyOS uygulamaları
* Docker dağıtımı
* [API](https://github.com/siyuan-note/siyuan/blob/master/API.md)
* Topluluk pazaryeri

Bazı özellikler yalnızca ücretli üyeler için geçerlidir. Detaylar için [Fiyatlandırma](https://b3log.org/siyuan/en/pricing.html) sayfasına göz atabilirsin.

## 🏗️ Mimari ve Ekosistem

![SiYuan Arch](https://b3logfile.com/file/2023/05/SiYuan_Arch-Sgu8vXT.png "SiYuan Arch")

| Proje                                                    | Açıklama              | Çatallama (Forks)                                                              | Yıldız (Stars)                                                                     |
|----------------------------------------------------------|-----------------------|--------------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| [lute](https://github.com/88250/lute)                    | Editör motoru         | ![GitHub forks](https://img.shields.io/github/forks/88250/lute)                | ![GitHub Repo stars](https://img.shields.io/github/stars/88250/lute)               |
| [chrome](https://github.com/siyuan-note/siyuan-chrome)   | Chrome/Edge eklentisi | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-chrome) | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-chrome) |
| [bazaar](https://github.com/siyuan-note/bazaar)          | Topluluk pazaryeri    | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/bazaar)        | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/bazaar)       |
| [dejavu](https://github.com/siyuan-note/dejavu)          | Veri deposu (repo)    | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/dejavu)        | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/dejavu)       |
| [petal](https://github.com/siyuan-note/petal)            | Eklenti API’si        | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/petal)         | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/petal)        |
| [android](https://github.com/siyuan-note/siyuan-android) | Android uygulaması    | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-android)| ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-android)|
| [ios](https://github.com/siyuan-note/siyuan-ios)         | iOS uygulaması        | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-ios)    | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-ios)   |
| [harmony](https://github.com/siyuan-note/siyuan-harmony) | HarmonyOS uygulaması  | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-harmony)| ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-harmony)|
| [riff](https://github.com/siyuan-note/riff)              | Aralıklı tekrar motoru| ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/riff)          | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/riff)         |

## 🌟 Yıldız Geçmişi

<a href="https://star-history.com/#siyuan-note/siyuan&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=siyuan-note/siyuan&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=siyuan-note/siyuan&type=Date" />
   <img alt="Yıldız Geçmişi Grafiği" src="https://api.star-history.com/svg?repos=siyuan-note/siyuan&type=Date" />
 </picture>
</a>

## 🗺️ Yol Haritası

* [SiYuan geliştirme planı ve ilerleme durumu](https://github.com/orgs/siyuan-note/projects/1)
* [SiYuan değişiklik günlüğü](CHANGELOG.md)

## 🚀 İndirme ve Kurulum

Masaüstü ve mobil cihazlarda uygulama mağazası üzerinden kurulumu tercih etmen önerilir. Böylece gelecekte tek tıkla sürüm yükseltmesi yapabilirsin.

### Uygulama Mağazası

Mobil:

* [App Store](https://apps.apple.com/us/app/siyuan/id1583226508)
* [Google Play](https://play.google.com/store/apps/details?id=org.b3log.siyuan)
* [F-Droid](https://f-droid.org/packages/org.b3log.siyuan)

Masaüstü:

* [Microsoft Store](https://apps.microsoft.com/detail/9p7hpmxp73k4)

### Kurulum Paketi

* [B3log](https://b3log.org/siyuan/en/download.html)
* [GitHub](https://github.com/siyuan-note/siyuan/releases)

### Paket Yöneticisi

#### `siyuan`

[![Paketleme durumu](https://repology.org/badge/vertical-allrepos/siyuan.svg)](https://repology.org/project/siyuan/versions)

#### `siyuan-note`

[![Paketleme durumu](https://repology.org/badge/vertical-allrepos/siyuan-note.svg)](https://repology.org/project/siyuan-note/versions)

### Docker Barındırma

<details>
<summary>Docker Dağıtımı</summary>

#### Genel Bakış

SiYuan’ı bir sunucuda çalıştırmanın en kolay yolu Docker üzerinden dağıtmaktır.

* Görüntü adı: `b3log/siyuan`
* [Docker Görüntüsü](https://hub.docker.com/r/b3log/siyuan)

#### Dosya Yapısı

Tüm program `/opt/siyuan/` dizini altındadır. Bu dizin, Electron kurulum paketinin `resources` klasör yapısına karşılık gelir:

* **appearance**: simgeler, temalar, diller  
* **guide**: kullanıcı kılavuzu belgeleri  
* **stage**: arayüz ve statik kaynaklar  
* **kernel**: çekirdek program

#### Giriş Noktası (Entrypoint)

Docker görüntüsü oluşturulurken giriş noktası şu şekilde ayarlanır: `ENTRYPOINT ["/opt/siyuan/entrypoint.sh"]` Bu betik (script), konteyner içinde çalışacak kullanıcının `PUID` (Kullanıcı ID) ve `PGID` (Grup ID) değerlerini değiştirmene olanak tanır. Bu, özellikle host dizinleri bağlarken oluşabilecek izin sorunlarını çözmek için önemlidir.

`docker run b3log/siyuan` komutunu çalıştırırken aşağıdaki parametreleri kullanabilirsin:

* `--workspace`: çalışma alanı klasör yolunu belirtir, host üzerinde `-v` parametresiyle bağlanır  
* `--accessAuthCode`: erişim yetkilendirme kodunu belirtir  

Tüm parametreleri görmek için `--help` komutunu kullanabilirsin. Yeni ortam değişkenleriyle bir örnek başlatma komutu aşağıdadır:

```bash
docker run -d \
  -v workspace_dir_host:workspace_dir_container \
  -p 6806:6806 \
  -e PUID=1001 -e PGID=1002 \
  b3log/siyuan \
  --workspace=workspace_dir_container \
  --accessAuthCode=xxx
```

* `PUID`: Özel kullanıcı kimliği (isteğe bağlı, belirtilmezse varsayılan değer `1000` olarak kullanılır)  
* `PGID`: Özel grup kimliği (isteğe bağlı, belirtilmezse varsayılan değer `1000` olarak kullanılır)  
* `workspace_dir_host`: Ana makinedeki (host) çalışma alanı klasör yolu  
* `workspace_dir_container`: Konteyner içindeki çalışma alanı klasör yolu (`--workspace` parametresiyle belirtilir)  
  * Alternatif olarak, bu yol `SIYUAN_WORKSPACE_PATH` ortam değişkeniyle de ayarlanabilir. Eğer her iki yöntem de kullanılırsa, **komut satırı önceliklidir**.  
* `accessAuthCode`: Erişim yetkilendirme kodu (**kesinlikle değiştir**, aksi halde herkes verilerine erişebilir)  
  * Alternatif olarak, yetkilendirme kodu `SIYUAN_ACCESS_AUTH_CODE` ortam değişkeniyle de ayarlanabilir. Yine, hem komut satırı hem ortam değişkeni kullanılırsa, **komut satırı önceliklidir**.  
  * Erişim yetkilendirme kodunu devre dışı bırakmak için şu ortam değişkenini ayarla: `SIYUAN_ACCESS_AUTH_CODE_BYPASS=true`  

Kurulumu basitleştirmek için, host ve konteyner üzerindeki çalışma alanı yollarını aynı şekilde ayarlaman önerilir. Örneğin her ikisini de `/siyuan/workspace` olarak tanımlayabilirsin. Buna karşılık gelen başlatma komutu şu şekildedir:

```bash
docker run -d \
  -v /siyuan/workspace:/siyuan/workspace \
  -p 6806:6806 \
  -e PUID=1001 -e PGID=1002 \
  b3log/siyuan \
  --workspace=/siyuan/workspace/ \
  --accessAuthCode=xxx
```

#### Docker Compose

SiYuan’ı Docker Compose ile çalıştıran kullanıcılar için, `PUID` ve `PGID` ortam değişkenleri kullanılarak kullanıcı ve grup kimlikleri özelleştirilebilir. Aşağıda örnek bir Docker Compose yapılandırması bulunmaktadır:

```yaml
version: "3.9"
services:
  main:
    image: b3log/siyuan
    command: ['--workspace=/siyuan/workspace/', '--accessAuthCode=${AuthCode}']
    ports:
      - 6806:6806
    volumes:
      - /siyuan/workspace:/siyuan/workspace
    restart: unless-stopped
    environment:
      # A list of time zone identifiers can be found at https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
      - TZ=${YOUR_TIME_ZONE}
      - PUID=${YOUR_USER_PUID}  # Customize user ID
      - PGID=${YOUR_USER_PGID}  # Customize group ID
```

Bu yapılandırmada:

* `PUID` ve `PGID` dinamik olarak ayarlanır ve konteynere aktarılır.  
* Eğer bu değişkenler belirtilmezse, varsayılan değer olarak `1000` kullanılır.  

`PUID` ve `PGID` değişkenlerini ortamda (environment) belirterek, `docker-compose.yml` dosyasında `user: '1000:1000'` satırını açıkça yazmana gerek kalmaz. Konteyner, başlatma sırasında bu ortam değişkenlerine göre kullanıcı ve grup ayarlarını otomatik olarak düzenler.

#### Kullanıcı İzinleri

Docker görüntüsünde yer alan `entrypoint.sh` betiği, belirtilen `PUID` ve `PGID` değerleriyle birlikte `siyuan` adlı kullanıcı ve grubun oluşturulmasını sağlar. Bu nedenle, ana makine (host) üzerinde çalışma alanı klasörü oluştururken, bu klasörün kullanıcı ve grup sahipliğini kullanmayı planladığın `PUID` ve `PGID` ile eşleşecek şekilde ayarladığından emin olmalısın. Örneğin:

```bash
chown -R 1001:1002 /siyuan/workspace
```

Eğer özel `PUID` ve `PGID` değerleri kullanıyorsan, `entrypoint` betiği konteyner içinde doğru kullanıcı ve grubun oluşturulmasını sağlar ve bağlanan (mount edilen) birimlerin sahipliği buna göre otomatik olarak ayarlanır. Bu nedenle `docker run` veya `docker-compose` komutlarında manuel olarak `-u` parametresi vermene gerek yoktur; ortam değişkenleri bu özelleştirmeyi zaten otomatik olarak halleder.

#### Gizli Port

Port 6806’yı gizlemek için NGINX ters proxy (reverse proxy) kullan. Dikkat edilmesi gerekenler:

* WebSocket ters proxy’sini `/ws` yoluna göre yapılandır.

#### Notlar

* Bağlanan (mount edilen) disk birimlerinin doğru olduğundan emin ol; aksi halde konteyner silindiğinde veriler kaybolur.  
* Yönlendirme (redirect) için URL yeniden yazımı (rewrite) kullanma; bu, kimlik doğrulamayla ilgili sorunlara neden olabilir. Bunun yerine ters proxy yapılandırmanı öneririz.  
* Eğer izin sorunlarıyla karşılaşırsan, `PUID` ve `PGID` ortam değişkenlerinin, ana makinedeki bağlanan dizinlerin sahipliğiyle uyuştuğundan emin ol.

#### Kısıtlamalar

* Masaüstü ve mobil uygulama bağlantılarını desteklemez; yalnızca tarayıcı üzerinden kullanım mümkündür.  
* PDF, HTML ve Word formatlarına dışa aktarma desteklenmez.  
* Markdown dosyası içe aktarma desteklenmez.

</details>

### Unraid Barındırma

<details>
<summary>Unraid Dağıtımı</summary>

Not: Terminalde önce şu komutu çalıştır: `chown -R 1000:1000 /mnt/user/appdata/siyuan`

Şablon referansı:

```
Web UI: 6806
Container Port: 6806
Container Path: /home/siyuan
Host path: /mnt/user/appdata/siyuan
PUID: 1000
PGID: 1000
Publish parameters: --accessAuthCode=******(Access authorization code)
```

</details>

### TrueNAS Barındırma

<details>
<summary>TrueNAS Dağıtım Dokümanı</summary>

Not: Önce TrueNAS Shell'te aşağıdaki komutları çalıştırın. Lütfen `Pool_1/Apps_Data/siyuan` yolunu uygulamanızın dataset'ine göre güncelleyin。

```shell
zfs create Pool_1/Apps_Data/siyuan
chown -R 1001:1002 /mnt/Pool_1/Apps_Data/siyuan
chmod 755 /mnt/Pool_1/Apps_Data/siyuan
```

Apps --> DiscoverApps --> More Options (sağ üst, Custom App hariç) --> YAML ile Yükle bölümüne gidin

Şablon örneği：

```yaml
services:
  siyuan:
    image: b3log/siyuan
    container_name: siyuan
    command: ['--workspace=/siyuan/workspace/', '--accessAuthCode=2222']
    ports:
      - 6806:6806
    volumes:
      - /mnt/Pool_1/Apps_Data/siyuan:/siyuan/workspace  # Adjust to your dataset path 
    restart: unless-stopped
    environment:
      - TZ=America/Los_Angeles  # Replace with your timezone if needed
      - PUID=1001
      - PGID=1002
```

</details>

### Erken Önizleme (Insider Preview)

Büyük güncellemelerden önce erken erişim (Insider Preview) sürümlerini yayınlıyoruz. Lütfen [https://github.com/siyuan-note/insider](https://github.com/siyuan-note/insider) adresini ziyaret edin.

## 🏘️ Topluluk

* [İngilizce Tartışma Forumu](https://liuyun.io)
* [Kullanıcı topluluğu özeti](https://liuyun.io/article/1687779743723)
* [Harika SiYuan (Awesome SiYuan)](https://github.com/siyuan-note/awesome)

## 🛠️ Geliştirme Rehberi

[Geliştirme Rehberi](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING.md) sayfasına göz atın.

## ❓ SSS (Sıkça Sorulan Sorular)

### SiYuan verileri nasıl saklar?

Veriler, çalışma alanı klasöründeki `data` klasöründe saklanır:

* `assets`: eklenen tüm varlıkların (dosya, resim vb.) kaydedildiği klasör  
* `emojis`: emoji görsellerinin kaydedildiği klasör  
* `snippets`: kod parçacıklarının kaydedildiği klasör  
* `storage`: sorgular, düzenler ve ezber kartları gibi verilerin saklandığı klasör  
* `templates`: şablon parçacıklarının kaydedildiği klasör  
* `widgets`: bileşenlerin kaydedildiği klasör  
* `plugins`: eklentilerin kaydedildiği klasör  
* `public`: genel verilerin saklandığı klasör  
* Diğer klasörler, kullanıcının oluşturduğu not defteri (notebook) klasörleridir. `.sy` uzantılı dosyalar belge verilerini saklar ve JSON formatındadır.

### Üçüncü taraf senkronizasyon diskiyle veri senkronizasyonu destekleniyor mu?

Üçüncü taraf senkronizasyon diskleriyle (örneğin OneDrive, Dropbox vb.) veri senkronizasyonu **desteklenmez**. Aksi takdirde veriler bozulabilir.

Bununla birlikte, üyelik avantajları kapsamında **üçüncü taraf bulut depolama hizmetleriyle bağlantı** desteklenmektedir.

Alternatif olarak, verileri **elle dışa aktarıp içe aktararak** senkronizasyon sağlayabilirsin:

* Masaüstü: <kbd>Ayarlar</kbd> → <kbd>Dışa Aktar</kbd> → <kbd>Verileri Dışa Aktar / Verileri İçe Aktar</kbd>  
* Mobil: <kbd>Sağ panel</kbd> → <kbd>Hakkında</kbd> → <kbd>Verileri Dışa Aktar / Verileri İçe Aktar</kbd>

### SiYuan açık kaynak mı?

Evet, SiYuan tamamen açık kaynaklıdır ve katkılara açıktır:

* [Kullanıcı Arayüzü ve Çekirdek](https://github.com/siyuan-note/siyuan)  
* [Android](https://github.com/siyuan-note/siyuan-android)  
* [iOS](https://github.com/siyuan-note/siyuan-ios)  
* [HarmonyOS](https://github.com/siyuan-note/siyuan-harmony)  
* [Chrome Kırpma Uzantısı](https://github.com/siyuan-note/siyuan-chrome)

Daha fazla bilgi için [Geliştirme Rehberi](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING.md) sayfasına bakabilirsiniz.

### Yeni bir sürüme nasıl yükseltilir?

* Uygulama mağazası üzerinden kurduysanız, güncellemeyi yine uygulama mağazası üzerinden yapın.  
* Masaüstü kurulum paketiyle yüklediyseniz, <kbd>Ayarlar</kbd> → <kbd>Hakkında</kbd> → <kbd>Güncelleme kurulum paketini otomatik indir</kbd> seçeneğini etkinleştirin. Böylece SiYuan, en son sürüm kurulum paketini otomatik indirip yükleme uyarısı gösterecektir.  
* Manuel yükleme yaptıysanız, en son kurulum paketini indirip yeniden yüklemeniz gerekir.

Ayrıca, <kbd>Ayarlar</kbd> → <kbd>Hakkında</kbd> → <kbd>Geçerli Sürüm</kbd> sekmesinden <kbd>Güncellemeyi kontrol et</kbd> seçeneğini kullanabilir veya [Resmî İndirme Sayfası](https://b3log.org/siyuan/en/download.html) ya da [GitHub Sürümleri](https://github.com/siyuan-note/siyuan/releases) sayfalarını takip edebilirsiniz.

### Bazı bloklar (örneğin liste öğelerindeki paragraflar) blok simgesini bulamıyorsa ne yapmalıyım?

Liste öğesinin altındaki ilk alt blok, blok simgesi görünmeyen bloktur. İmleci bu bloğa getirip <kbd>Ctrl+/</kbd> tuş kombinasyonuyla blok menüsünü açabilirsin.

### Veri deposu anahtarı (data repo key) kaybolursa ne yapmalıyım?

* Eğer daha önce birden fazla cihazda doğru şekilde başlatıldıysa, tüm cihazlarda aynı anahtar kullanılır. Bu durumda anahtarı şu adımlarla kopyalayabilirsin:
  <kbd>Ayarlar</kbd> → <kbd>Hakkında</kbd> → <kbd>Veri deposu anahtarı</kbd> → <kbd>Anahtar dizgesini kopyala</kbd>  
* Eğer cihazlar arasında farklı anahtarlar kullanılmışsa veya hiçbiri erişilebilir değilse, aşağıdaki adımlarla yeni bir anahtar oluşturabilirsin:

  1. Verilerini manuel olarak yedekle (<kbd>Verileri Dışa Aktar</kbd> seçeneğiyle veya dosya sisteminde `workspace/data/` klasörünü kopyalayarak).  
  2. <kbd>Ayarlar</kbd> → <kbd>Hakkında</kbd> → <kbd>Veri deposu anahtarı</kbd> → <kbd>Veri deposunu sıfırla</kbd>.  
  3. Anahtarı yeniden başlat. Bir cihazda oluşturduktan sonra diğer cihazlara bu anahtarı aktar.  
  4. Bulutta yeni senkronizasyon dizinini kullan; eski dizin artık erişilemez ve silinebilir.  
  5. Mevcut bulut anlık görüntüleri (snapshot) artık geçerli değildir, bunlar da silinebilir.

### Ücretli mi?

Çoğu özellik ücretsizdir — ticari kullanım da dahil. 

Ancak üyelik ayrıcalıkları yalnızca ödeme sonrasında kullanılabilir. Detaylar için [Fiyatlandırma](https://b3log.org/siyuan/en/pricing.html) sayfasına bakabilirsiniz.

## 🙏 Teşekkür

SiYuan’ın doğuşu, birçok açık kaynak projesi ve katkıcısının emeğiyle mümkün olmuştur. Daha fazla bilgi için proje kaynak kodlarındaki `kernel/go.mod`, `app/package.json` ve proje anasayfasına bakabilirsiniz.

SiYuan’ın gelişimi, kullanıcı geri bildirimleri ve desteğiyle büyümeye devam ediyor. SiYuan’a katkı sağlayan herkese teşekkürler ❤️

### Katkıda Bulunanlar

Bize katıl ve SiYuan’a birlikte katkı yap! 💪  

<a href="https://github.com/siyuan-note/siyuan/graphs/contributors">
   <img src="https://contrib.rocks/image?repo=siyuan-note/siyuan" />
</a>
