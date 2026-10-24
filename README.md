# LikeSpot

[Songspot](https://songspot.net/genres/pop)'tan esinlenen bir şarkı tahmin oyunu — ama şarkılar **Spotify'da beğendiğin şarkılardan** geliyor.
Kısacık bir klip çalar; bilemezsen ya da atlarsan klip uzar.

## Zorluklar

Her zorlukta klipler aynı: **0.1 · 0.5 · 2 · 8 · 15 sn**. Bilemezsen ya da atlarsan sonraki klibe geçilir.

| Zorluk   | Cevap                       | Klip yeri          | Puan çarpanı |
|----------|-----------------------------|--------------------|--------------|
| Kolay    | 4 şık                       | Önizlemenin başı   | ×1 |
| Orta     | 4 şık                       | Rastgele           | ×2 |
| Zor      | Yazarak (önerili)           | Önizlemenin başı   | ×3 |
| Uzman    | Yazarak (önerili)           | Rastgele           | ×4 |
| İmkânsız | Yazarak, öneri yok          | Rastgele           | ×5 |

Ayrıca: soru tipi (şarkı adı / sanatçı / karışık), dönem filtresi ve ses kaynağı seçilebilir.
Puan = kalan hak × zorluk çarpanı. İstatistikler tarayıcıda saklanır.

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
   python -m http.server 5173 --bind 127.0.0.1
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
