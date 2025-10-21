# Telegram Mail Bot

Bu Telegram botu, kullanıcılara mail oluşturma ve gönderme imkanı sunar. Bot, yapay zeka, manuel yazım ve şablon seçimi gibi farklı yöntemlerle mail oluşturma özelliklerine sahiptir.

## Özellikler

### Mail Oluşturma Yöntemleri

1. **🤖 Yapay Zeka ile Oluşturma**: OpenAI GPT kullanarak otomatik mail içeriği oluşturma
2. **✍️ Manuel Oluşturma**: Kullanıcının kendisinin mail içeriğini yazması
3. **📋 Şablonlardan Seçme**: Önceden hazırlanmış şablonları kullanma

### Mail Yönetimi

- Mail düzenleme imkanı
- Dosya/resim ekleme (yakında)
- Mail önizleme

### Alıcı Yönetimi

- **Excel ile Toplu**: Excel dosyasından mail adreslerini okuma
- **Manuel Gir**: Tek tek mail adresi girme

## Kurulum

### Gereksinimler

- Node.js (v14 veya üzeri)
- Telegram Bot Token
- OpenAI API Key
- Gmail hesabı (App Password gerekli)

### Adımlar

1. **Projeyi klonlayın ve bağımlılıkları yükleyin:**

```bash
npm install
```

2. **Environment dosyasını oluşturun:**
   `.env` dosyası oluşturun ve aşağıdaki bilgileri doldurun:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
OPENAI_API_KEY=your_openai_api_key_here
EMAIL_ADDRESS=your_email@gmail.com
EMAIL_PASSWORD=your_app_password_here
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
ADMIN_USER_IDS=your_telegram_user_id_here

## Gmail API (HTTPS) – Personal Gmail via OAuth2

Set these when using personal Gmail (OAuth2 refresh token):

```

GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_SENDER=your_email@gmail.com

```

Alternatively, for Google Workspace with a Service Account, set:

```

GMAIL_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GMAIL_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GMAIL_SENDER=sender@yourdomain.com

```

Note: If SMTP verification fails (e.g., blocked ports), the app falls back to Gmail API when the above variables are present.
```

**Not:** Eğer `.env` dosyası oluşturmakta sorun yaşıyorsanız, `config.js` dosyasındaki değerleri doğrudan düzenleyebilirsiniz.

3. **Botu başlatın:**

```bash
npm start
```

**Önemli Not:** Bot asla arka planda çalıştırılmamalıdır. Manuel olarak çalıştırın:

```bash
# Botu başlatmak için
npm start

# Botu durdurmak için
npm run stop

# Botu yeniden başlatmak için
npm run restart
```

## Kullanım

### Bot Komutları

- `/start` - Ana menüyü gösterir

### Mail Oluşturma Süreci

#### 1. Yapay Zeka ile Oluşturma

1. "🤖 Yapay Zeka ile Oluştur" seçeneğini seçin
2. Mail konusunu girin
3. Mail içeriği hakkında kısa açıklama yapın
4. Ton seçin (Resmi, Samimi, Profesyonel, Casual)
5. AI otomatik olarak mail içeriğini oluşturur

#### 2. Manuel Oluşturma

1. "✍️ Manuel Oluştur" seçeneğini seçin
2. Mail konusunu girin
3. Mail içeriğini yazın

#### 3. Şablonlardan Seçme

1. "📋 Şablonlardan Seç" seçeneğini seçin
2. Mevcut şablonlardan birini seçin
3. Şablon otomatik olarak mail içeriği olarak ayarlanır

### Mail Düzenleme

- Mail hazır olduktan sonra "✏️ Düzenle" butonuna basın
- Yeni içeriği gönderin
- Bot yeni içeriği kabul eder

### Alıcı Belirleme

#### Excel ile Toplu

1. "📊 Excel ile Toplu" seçeneğini seçin
2. Excel dosyasını gönderin
3. Bot ilk sütundaki ikinci satırdan itibaren mail adreslerini okur

#### Manuel Gir

1. "✍️ Manuel Gir" seçeneğini seçin
2. Mail adreslerini alt alta yazın
3. Her satıra bir mail adresi yazın

### Mail Gönderme

1. Alıcıları belirledikten sonra son önizleme gösterilir
2. "✅ Gönder" butonuna basarak maili gönderin
3. Bot mail gönderme durumunu bildirir

## Güvenlik

- Bot sadece belirtilen admin kullanıcıları tarafından kullanılabilir
- `.env` dosyasını asla public repository'ye commit etmeyin
- Gmail için App Password kullanın, normal şifre değil

## Geliştirme

### Yeni Şablon Ekleme

`bot.js` dosyasındaki `emailTemplates` objesine yeni şablon ekleyebilirsiniz:

```javascript
const emailTemplates = {
  // Mevcut şablonlar...
  new_template: {
    subject: "Yeni Şablon Konusu",
    content: "Şablon içeriği...",
  },
};
```

### Yaygın Hatalar

1. **"Bu botu kullanma yetkiniz yok"**: ADMIN_USER_IDS'e kendi Telegram ID'nizi ekleyin
2. **Mail gönderilemiyor**: Gmail App Password kullandığınızdan emin olun
3. **OpenAI hatası**: API key'inizin geçerli olduğundan emin olun
4. **"OAuth2 refresh token expired"**: Gmail OAuth token'ı süresi dolmuş

### OAuth Token Yenileme

Eğer `invalid_grant` veya `OAuth2 refresh token expired` hatası alıyorsanız:

1. **Yeni token almak için**:

   ```bash
   node oauth-refresh-token.js
   ```

2. **Environment variables'ı güncelleyin**:

   - Railway dashboard'da `GMAIL_REFRESH_TOKEN` değerini yeni token ile güncelleyin
   - Veya `.env` dosyasında güncelleyin

3. **Token süresi**: Refresh token'lar genellikle 6 ay geçerlidir
4. **Otomatik yenileme**: Bot artık token hatalarını yakalar ve daha açıklayıcı hata mesajları verir

### Log Takibi

Bot çalışırken console'da hata mesajlarını takip edebilirsiniz.

## Lisans

MIT License
