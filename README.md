# LikeSpot

[Songspot](https://songspot.net/genres/pop)'tan esinlenen bir şarkı tahmin oyunu — ama şarkılar **Spotify'da beğendiğin şarkılardan** geliyor.
Kısacık bir klip çalar; bilemezsen ya da atlarsan klip uzar.

**Canlı site:** https://ebru-tumer.github.io/likespot/

Giriş yolları: Spotify, YouTube Music (Google girişi), giriş yapmadan YouTube Music çalma listesi linki ya da demo.

## Zorluklar

Her zorlukta klipler aynı: **0.1 · 0.5 · 2 · 8 · 15 sn** ve cevap her zaman yazılarak verilir.
Bilemezsen ya da atlarsan sonraki klibe geçilir.

| Zorluk   | Yazarken öneri | Klip yeri                          | Puan çarpanı |
|----------|----------------|------------------------------------|--------------|
| Kolay    | İlk harften    | Önizlemenin başı                   | ×1 |
| Orta     | İlk harften    | Rastgele                           | ×2 |
| Zor      | 2 harften sonra| Önizlemenin başı                   | ×3 |
| Uzman    | 3 harften sonra| Rastgele                           | ×4 |
| İmkânsız | 3 harften sonra| Her adımda başka rastgele bir yer  | ×5 |

Ayrıca şunlar seçilebilir:
- **Soru:** şarkı adı / sanatçı / karışık
- **Dil:** Karışık / Türkçe / İngilizce
- **Dönem** ve **ses kaynağı**

Puan = kalan hak × zorluk çarpanı. İstatistikler tarayıcıda saklanır.

### Dil tespiti

Spotify şarkının dilini vermediği için tahmin edilir. Başlıktaki Türkçe harf ve kelimelere ve
sanatçının Spotify türlerine (turkish pop, arabesk, anadolu rock…) bakılır. Bir sanatçının
bir şarkısı Türkçe sayılırsa diğer şarkıları da Türkçe sayılır. "İngilizce" Türkçe olmayan her şarkıyı kapsar.

## Ses kaynakları

- **Önizleme (varsayılan):** Şarkının iTunes'taki 30 saniyelik önizlemesi bulunur ve Web Audio ile milisaniye hassasiyetinde çalınır. Önizlemesi bulunamayan şarkılar otomatik atlanır.
- **Spotify (tam şarkı):** Spotify Web Playback SDK ile şarkının kendisinden çalar. Spotify Premium gerekir; çok kısa kliplerde (0.1 sn) zamanlama daha az hassastır.

> Spotify, yeni uygulamalar için `preview_url` alanını artık doldurmadığından önizlemeler iTunes'tan alınır.

## Kurulum

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)'da bir uygulama oluştur. API olarak **Web API** ve **Web Playback SDK**'yı seç.
2. **Redirect URI** olarak `http://127.0.0.1:5173/` ekle (Spotify `localhost` kabul etmiyor, `127.0.0.1` kullan).
3. Uygulamanın **User Management** bölümüne kendi Spotify e-postanı ekle (geliştirme modundaki uygulamalar en fazla 5 kullanıcıya açıktır ve uygulama sahibinin Premium olması gerekir).
4. Siteyi başlat:

   ```bash
   python serve.py
   ```

5. Tarayıcıda `http://127.0.0.1:5173/` aç, Client ID'yi yapıştır ve **Spotify ile bağlan**'a bas.

Bağlanmadan denemek için **Bağlanmadan demo oyna** butonu popüler şarkılarla çalışır.

## Yapı

Derleme adımı yok; düz HTML + CSS + ES modülleri.

```
index.html
css/style.css
js/auth.js      Spotify PKCE girişi ve token yenileme
js/library.js   Beğenilen şarkıları çekme ve önbellek
js/players.js   iTunes önizleme ve Spotify SDK oynatıcıları
js/game.js      Zorluklar, şarkı seçimi, cevap kontrolü, istatistik
js/demo.js      Demo şarkı listesi
js/main.js      Arayüz ve oyun akışı
```
