require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const XLSX = require('xlsx');
const fs = require('fs');
const config = require('./config');
const ui = require('./ui');
const flows = require('./flows');
const {
  saveUserState,
  getUserState,
  getUserData,
  clearUserState,
  saveUserMessage,
  getUserMessage,
  setLastInteraction,
  getLastInteraction,
} = require('./state');
const { handleAttachment } = require('./attachments');
const { downloadFile } = require('./utils');

// Check if required environment variables are set
function checkEnvironmentVariables() {
  const requiredVars = [
    'TELEGRAM_BOT_TOKEN',
    'EMAIL_ADDRESS',
    'EMAIL_PASSWORD',
    'ADMIN_USER_IDS'
  ];
  
  const missingVars = requiredVars.filter(varName => {
    const value = process.env[varName];
    return !value || value.includes('your_') || value.includes('_here');
  });
  
  if (missingVars.length > 0) {
    console.error('❌ Missing or invalid environment variables:');
    missingVars.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\n📝 Please create a .env file with the following variables:');
    console.error('TELEGRAM_BOT_TOKEN=your_actual_bot_token');
    console.error('OPENAI_API_KEY=sk_your_actual_openai_key');
    console.error('EMAIL_ADDRESS=your_email@gmail.com');
    console.error('EMAIL_PASSWORD=your_app_password');
    console.error('ADMIN_USER_IDS=your_telegram_user_id');
    console.error('\n💡 You can copy the values from config.js as a template.');
    process.exit(1);
  }
}

// Check environment variables before starting
checkEnvironmentVariables();

// Bot yapılandırması
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN, { polling: true });

// State is managed in ./state

// Mail şablonları
const emailTemplates = {
  meeting_reminder: {
    subject: "Toplantı Hatırlatması",
    content: `Merhaba,

Bu mail, [TOPLANTI ADI] toplantısı için bir hatırlatmadır.

Toplantı Detayları:
- Tarih: [TARİH]
- Saat: [SAAT]
- Yer: [YER]
- Konu: [KONU]

Lütfen toplantıya zamanında katılım sağlayınız.

İyi günler,
[İMZA]`
  }
};

// Yardımcı fonksiyonlar
function isAdmin(userId) {
  const adminIdsString = process.env.ADMIN_USER_IDS || config.ADMIN_USER_IDS;
  const adminIds = adminIdsString.split(',').map(id => parseInt(id.trim()));
  return adminIds.includes(userId);
}

// State helpers imported from ./state

// Eski kartı sil ve yeni kart oluştur (sadece manuel input için)
async function replaceCard(chatId, userId, newMessage, options) {
  const oldMessageId = getUserMessage(userId);
  const last = getLastInteraction(userId);

  // Eğer son etkileşim callback ise, silme yerine güncelle (silme efekti yok)
  if (last === 'callback' && oldMessageId) {
    await ui.updateCard(bot, chatId, userId, newMessage, options);
    return { message_id: getUserMessage(userId) };
  }

  // Son etkileşim kullanıcı mesajı ise: eskiyi sil, yenisini gönder
  if (oldMessageId) {
    try {
      await bot.deleteMessage(chatId, oldMessageId);
    } catch (error) {
      console.log('Could not delete old message:', error.message);
    }
  }

  const newMsg = await bot.sendMessage(chatId, newMessage, options);
  saveUserMessage(userId, newMsg.message_id);
  return newMsg;
}

// Callback için kart güncelle (silme efekti yok)
async function updateCard(chatId, userId, newMessage, options) {
  const messageId = getUserMessage(userId);

  if (messageId) {
    try {
      await bot.editMessageText(newMessage, { chat_id: chatId, message_id: messageId, ...(options || {}) });
    } catch (error) {
      console.log('Could not update message:', error.message);
      // Eğer güncelleme başarısız olursa yeni mesaj gönder ve eskiyi sil
      const newMsg = await bot.sendMessage(chatId, newMessage, options);
      saveUserMessage(userId, newMsg.message_id);
      try {
        await bot.deleteMessage(chatId, messageId);
      } catch (delErr) {
        console.log('Could not delete stale message after failed edit:', delErr.message);
      }
    }
  } else {
    // Eğer messageId yoksa yeni mesaj gönder
    const newMsg = await bot.sendMessage(chatId, newMessage, options);
    saveUserMessage(userId, newMsg.message_id);
  }
}

// downloadFile imported from ./utils

// Ana menü
async function showMainMenu(chatId, messageId = null, userId = null) {
  return ui.showMainMenu(bot, chatId, userId, messageId);
}

// Yapay zeka ile mail oluşturma
async function createWithAI(chatId, userId, callbackMessageId = null) {
  saveUserState(userId, 'ai_subject');
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔙 Geri Dön", callback_data: "back_to_main" },
          { text: "🏠 Ana Menü", callback_data: "main_menu" }
        ]
      ]
    }
  };
  
  if (callbackMessageId) {
    await updateCard(chatId, userId, "Mail konusunu girin:", keyboard);
  } else {
    const msg = await bot.sendMessage(chatId, "Mail konusunu girin:", keyboard);
    saveUserMessage(userId, msg.message_id);
  }
}

async function processAISubject(chatId, userId, subject) {
  const userData = getUserData(userId);
  saveUserState(userId, 'ai_content', { ...userData, subject });
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔙 Geri Dön", callback_data: "back_to_main" },
          { text: "🏠 Ana Menü", callback_data: "main_menu" }
        ]
      ]
    }
  };
  
  await replaceCard(chatId, userId, "Mail içeriği hakkında kısaca ne yazmak istediğinizi belirtin:", keyboard);
}

async function processAIContent(chatId, userId, content) {
  saveUserState(userId, 'ai_tone', { content });
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Resmi", callback_data: "tone_formal" },
          { text: "Samimi", callback_data: "tone_friendly" }
        ],
        [
          { text: "Profesyonel", callback_data: "tone_professional" },
          { text: "Casual", callback_data: "tone_casual" }
        ],
        [
          { text: "🔙 Geri Dön", callback_data: "back_to_main" },
          { text: "🏠 Ana Menü", callback_data: "main_menu" }
        ]
      ]
    }
  };
  
  await replaceCard(chatId, userId, "Mail hangi tonda yazılsın?", keyboard);
}

async function processAITone(chatId, userId, tone) {
  const userData = getUserData(userId);
  const { subject, content } = userData;
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔙 Geri Dön", callback_data: "back_to_main" },
          { text: "🏠 Ana Menü", callback_data: "main_menu" }
        ]
      ]
    }
  };
  
  try {
    const processingMsg = await replaceCard(chatId, userId, "Yapay zeka mail içeriğini oluşturuyor, lütfen bekleyin...", keyboard);
    
    const prompt = `Aşağıdaki bilgilere göre ${tone} tonda bir email yaz:
Konu: ${subject}
İçerik: ${content}
Ton: ${tone}

Email'i Türkçe olarak yaz ve profesyonel bir format kullan.`;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
    });
    
    const emailContent = completion.choices[0].message.content;
    saveUserState(userId, 'email_ready', { 
      subject, 
      content: emailContent,
      method: 'ai'
    });
    
    showEmailPreview(chatId, userId, subject, emailContent, processingMsg.message_id);
  } catch (error) {
    console.error('OpenAI Error:', error);
    await replaceCard(chatId, userId, "Yapay zeka ile mail oluşturulurken hata oluştu. Lütfen tekrar deneyin.", keyboard);
    setTimeout(() => showMainMenu(chatId, getUserMessage(userId), userId), 2000);
  }
}

// Manuel mail oluşturma
async function createManual(chatId, userId, callbackMessageId = null) {
  saveUserState(userId, 'manual_subject');
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔙 Geri Dön", callback_data: "back_to_main" },
          { text: "🏠 Ana Menü", callback_data: "main_menu" }
        ]
      ]
    }
  };
  
  if (callbackMessageId) {
    await updateCard(chatId, userId, "Mail konusunu girin:", keyboard);
  } else {
    const msg = await bot.sendMessage(chatId, "Mail konusunu girin:", keyboard);
    saveUserMessage(userId, msg.message_id);
  }
}

async function processManualSubject(chatId, userId, subject) {
  const userData = getUserData(userId);
  saveUserState(userId, 'manual_content', { ...userData, subject });
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔙 Geri Dön", callback_data: "back_to_main" },
          { text: "🏠 Ana Menü", callback_data: "main_menu" }
        ]
      ]
    }
  };
  
  await replaceCard(chatId, userId, "Mail içeriğini girin:", keyboard);
}

async function processManualContent(chatId, userId, content) {
  const userData = getUserData(userId);
  const { subject } = userData;
  
  saveUserState(userId, 'email_ready', { 
    subject, 
    content,
    method: 'manual'
  });
  
  await showEmailPreview(chatId, userId, subject, content);
}

// Şablon seçimi
async function showTemplates(chatId, userId, messageId = null) {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📅 Toplantı Hatırlatması", callback_data: "template_meeting_reminder" }
        ]
      ]
    }
  };
  
  const message = "Hangi şablonu kullanmak istiyorsunuz?";
  
  if (messageId) {
    await updateCard(chatId, userId, message, keyboard);
  } else {
    const msg = await bot.sendMessage(chatId, message, keyboard);
    saveUserMessage(userId, msg.message_id);
  }
}

async function processTemplate(chatId, userId, templateKey) {
  const template = emailTemplates[templateKey];
  if (template) {
    saveUserState(userId, 'email_ready', { 
      subject: template.subject, 
      content: template.content,
      method: 'template'
    });
    
    await showEmailPreview(chatId, userId, template.subject, template.content);
  }
}

// Mail önizleme
async function showEmailPreview(chatId, userId, subject, content) {
  const userData = getUserData(userId);
  const attachments = userData.attachments || [];
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✏️ Düzenle", callback_data: "edit_email" },
          { text: "📎 Dosya Ekle", callback_data: "add_attachment" }
        ],
        [
          { text: "➡️ Alıcıları Belirle", callback_data: "set_recipients" }
        ]
      ]
    }
  };
  
  let preview = `📧 **Mail Önizlemesi**

**Konu:** ${subject}

**İçerik:**
${content}`;

  if (attachments.length > 0) {
    preview += `\n\n**📎 Eklenen Dosyalar:**\n${attachments.map((file, index) => `${index + 1}. ${file.name}`).join('\n')}`;
  }

  preview += `\n\nMail hazır! Ne yapmak istiyorsunuz?`;
  
  await replaceCard(chatId, userId, preview, { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });
}

// Mail düzenleme
async function editEmail(chatId, userId) {
  const userData = getUserData(userId);
  saveUserState(userId, 'editing_email');
  
  const message = `Mevcut mail içeriği:\n\n${userData.content}\n\nDüzenlenmiş içeriği gönderin:`;
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔙 Geri Dön", callback_data: "back_to_main" },
          { text: "🏠 Ana Menü", callback_data: "main_menu" }
        ]
      ]
    }
  };
  
  await replaceCard(chatId, userId, message, keyboard);
}

async function processEditedEmail(chatId, userId, newContent) {
  const userData = getUserData(userId);
  saveUserState(userId, 'email_ready', { 
    ...userData, 
    content: newContent 
  });
  
  await showEmailPreview(chatId, userId, userData.subject, newContent);
}

// Alıcı belirleme
async function showRecipientOptions(chatId, userId) {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📊 Excel ile Toplu", callback_data: "recipients_excel" }
        ],
        [
          { text: "✍️ Manuel Gir", callback_data: "recipients_manual" }
        ]
      ]
    }
  };
  
  const message = "Alıcıları nasıl belirlemek istiyorsunuz?";
  
  await replaceCard(chatId, userId, message, keyboard);
}

async function processExcelRecipients(chatId, userId) {
  saveUserState(userId, 'waiting_excel');
  
  const message = "Excel dosyasını gönderin. Dosyada ilk sütundaki ikinci satırdan itibaren mail adresleri olmalı.";
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔙 Geri Dön", callback_data: "back_to_main" },
          { text: "🏠 Ana Menü", callback_data: "main_menu" }
        ]
      ]
    }
  };
  
  await replaceCard(chatId, userId, message, keyboard);
}

async function processManualRecipients(chatId, userId) {
  saveUserState(userId, 'manual_recipients');
  
  const message = "Mail adreslerini alt alta yazın (her satıra bir mail adresi):";
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔙 Geri Dön", callback_data: "back_to_main" },
          { text: "🏠 Ana Menü", callback_data: "main_menu" }
        ]
      ]
    }
  };
  
  await replaceCard(chatId, userId, message, keyboard);
}

async function processRecipients(chatId, userId, recipients) {
  const userData = getUserData(userId);
  saveUserState(userId, 'ready_to_send', { 
    ...userData, 
    recipients 
  });
  
  await showFinalPreview(chatId, userId);
}

async function showFinalPreview(chatId, userId) {
  const userData = getUserData(userId);
  const { subject, content, recipients } = userData;
  
  const preview = `📧 **Son Mail Önizlemesi**

**Konu:** ${subject}

**Alıcılar:** ${recipients.join(', ')}

**İçerik:**
${content}

Maili göndermek istiyor musunuz?`;
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Onayla", callback_data: "send_email" }
        ],
        [
          { text: "🔙 Geri Dön", callback_data: "back_to_main" },
          { text: "🏠 Ana Menü", callback_data: "main_menu" }
        ]
      ]
    }
  };
  
  await replaceCard(chatId, userId, preview, { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });
}

// Mail gönderme
async function sendEmail(chatId, userId) {
  const userData = getUserData(userId);
  const { subject, content, recipients, attachments = [] } = userData;
  const messageId = getUserMessage(userId);
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔙 Geri Dön", callback_data: "back_to_main" },
          { text: "🏠 Ana Menü", callback_data: "main_menu" }
        ]
      ]
    }
  };
  
  try {
    bot.editMessageText("Mail gönderiliyor...", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard.reply_markup
    });
    
    const mailOptions = {
      from: process.env.EMAIL_ADDRESS || config.EMAIL_ADDRESS,
      to: recipients.join(', '),
      subject: subject,
      text: content,
    };
    
    // Ek dosyalar varsa ekle
    if (attachments.length > 0) {
      mailOptions.attachments = attachments.map(file => ({
        filename: file.name,
        content: file.content,
        contentType: file.mimeType
      }));
    }
    
    await transporter.sendMail(mailOptions);
    
    bot.editMessageText(`✅ Mail başarıyla gönderildi!\n\nAlıcılar: ${recipients.join(', ')}`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard.reply_markup
    });
    
    clearUserState(userId);
    
    // Kısa bir gecikme sonrası ana menüyü göster
    setTimeout(() => {
      showMainMenu(chatId, messageId, userId);
    }, 2000);
    
  } catch (error) {
    console.error('Email Error:', error);
    bot.editMessageText("Mail gönderilirken hata oluştu. Lütfen tekrar deneyin.", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard.reply_markup
    });
  }
}

// Event handlers
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  console.log('Message received:', { userId, text, chatId });
  
  // Admin kontrolü
  if (!isAdmin(userId)) {
    bot.sendMessage(chatId, "Bu botu kullanma yetkiniz yok.");
    return;
  }
  
  const state = getUserState(userId);
  console.log('User state:', state);
  
  if (text === '/start') {
    clearUserState(userId);
    showMainMenu(chatId, null, userId);
    return;
  }
  
  // Son etkileşim: kullanıcı mesajı
  setLastInteraction(userId, 'message');

  switch (state) {
    case 'ai_subject':
      console.log('Processing AI subject:', text);
      await flows.processAISubject(bot, chatId, userId, text);
      break;
      
    case 'ai_content':
      console.log('Processing AI content:', text);
      await flows.processAIContent(bot, chatId, userId, text);
      break;
      
    case 'manual_subject':
      console.log('Processing manual subject:', text);
      await flows.processManualSubject(bot, chatId, userId, text);
      break;
      
    case 'manual_content':
      console.log('Processing manual content:', text);
      await flows.processManualContent(bot, chatId, userId, text);
      break;
      
    case 'editing_email':
      console.log('Processing edited email:', text);
      await flows.processEditedEmail(bot, chatId, userId, text);
      break;
      
    case 'manual_recipients':
      console.log('Processing manual recipients:', text);
      const recipients = text.split('\n').map(email => email.trim()).filter(email => email);
      await flows.processRecipients(bot, chatId, userId, recipients);
      break;
      
    case 'waiting_attachment':
      console.log('Waiting for attachment, but got text:', text);
      // Bu durumda kullanıcı dosya göndermiş olmalı, document handler'da işlenecek
      break;
      
    default:
      console.log('No matching state for:', state);
      break;
  }
});

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  // Admin kontrolü
  if (!isAdmin(userId)) {
    bot.answerCallbackQuery(callbackQuery.id, "Bu botu kullanma yetkiniz yok.");
    return;
  }
  
  // Son etkileşim: callback
  setLastInteraction(userId, 'callback');
  // Mesaj ID'sini kaydet
  saveUserMessage(userId, messageId);
  
  switch (data) {
    case 'create_ai':
      await flows.createWithAI(bot, chatId, userId, messageId);
      break;
      
    case 'create_manual':
      await flows.createManual(bot, chatId, userId, messageId);
      break;
      
    case 'create_template':
      await flows.showTemplates(bot, chatId, userId, messageId);
      break;
      
    case 'template_meeting_reminder':
      await flows.processTemplate(bot, chatId, userId, emailTemplates['meeting_reminder']);
      break;
      
    case 'tone_formal':
      await flows.processAITone(bot, chatId, userId, 'resmi');
      break;
      
    case 'tone_friendly':
      await flows.processAITone(bot, chatId, userId, 'samimi');
      break;
      
    case 'tone_professional':
      await flows.processAITone(bot, chatId, userId, 'profesyonel');
      break;
      
    case 'tone_casual':
      await flows.processAITone(bot, chatId, userId, 'casual');
      break;
      
    case 'edit_email':
      await flows.editEmail(bot, chatId, userId);
      break;
      
    case 'regenerate_email':
      if (typeof flows.regenerateAIEmail === 'function') {
        await flows.regenerateAIEmail(bot, chatId, userId);
      }
      break;

    case 'add_attachment':
      saveUserState(userId, 'waiting_attachment');
      const attachmentKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔙 Geri Dön", callback_data: "back_to_main" },
              { text: "🏠 Ana Menü", callback_data: "main_menu" }
            ]
          ]
        }
      };
      
      await ui.updateCard(bot, chatId, userId, "📎 Eklenecek dosyayı gönderin (resim, PDF, Word, Excel vb.):", attachmentKeyboard);
      break;
      
    case 'set_recipients':
      await flows.showRecipientOptions(bot, chatId, userId);
      break;
      
    case 'recipients_excel':
      await flows.processExcelRecipients(bot, chatId, userId);
      break;
      
    case 'recipients_manual':
      await flows.processManualRecipients(bot, chatId, userId);
      break;
      
    case 'send_email':
      await flows.sendEmail(bot, chatId, userId);
      break;
      
    case 'confirm_recipients': {
      const dataState = getUserData(userId);
      const emails = Array.isArray(dataState?.pendingRecipients) ? dataState.pendingRecipients : [];
      if (emails.length === 0) {
        await flows.showRecipientOptions(bot, chatId, userId);
        break;
      }
      // Mevcut state zaten 'confirm_recipients'; direkt bir sonraki adıma ilerle
      await flows.processRecipients(bot, chatId, userId, emails);
      break;
    }

    case 'cancel_recipients':
      // Onay ekranından vazgeçildi; alıcı belirleme seçeneklerine geri dön
      await flows.showRecipientOptions(bot, chatId, userId);
      break;

    // Removed explicit cancel flow per requirement; user can always go back or main menu
      
    case 'back_to_main':
      try {
        await flows.goBack(bot, chatId, userId);
      } catch (e) {
        await showMainMenu(chatId, messageId, userId);
      }
      break;
      
    case 'main_menu':
      clearUserState(userId);
      await showMainMenu(chatId, messageId, userId);
      break;
  }
  
  bot.answerCallbackQuery(callbackQuery.id);
});

// Dosya işleme (Excel ve ek dosyalar)
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const state = getUserState(userId);
  
  console.log('Document received:', {
    userId,
    state,
    fileName: msg.document?.file_name,
    fileId: msg.document?.file_id
  });
  
  // Admin kontrolü
  if (!isAdmin(userId)) {
    bot.sendMessage(chatId, "Bu botu kullanma yetkiniz yok.");
    return;
  }
  
  // Son etkileşim: kullanıcı mesajı (belge yüklemesi)
  setLastInteraction(userId, 'message');
  
  if (state === 'waiting_excel') {
    try {
      const fileId = msg.document.file_id;
      const fileName = msg.document.file_name;
      const messageId = getUserMessage(userId);

      // İşleniyor durumunu, önceki kartı silip altta yeni kart olarak göster
      const excelKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔙 Geri Dön", callback_data: "back_to_main" },
              { text: "🏠 Ana Menü", callback_data: "main_menu" }
            ]
          ]
        }
      };
      await replaceCard(chatId, userId, "📊 Excel dosyası işleniyor, lütfen bekleyin...", excelKeyboard);
      
      // Dosyayı indir
      const file = await bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      
      // Dosyayı indir
      const fileContent = await downloadFile(fileUrl);
      const filePath = `./temp_${Date.now()}_${fileName}`;
      
      // Dosyayı disk'e yaz
      fs.writeFileSync(filePath, fileContent);
      
      // Excel dosyasını oku
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      // İlk sütundaki ikinci satırdan itibaren mail adreslerini al
      const emails = data.slice(1).map(row => row[0]).filter(email => email && email.includes('@'));
      
      if (emails.length === 0) {
        const errorMessage = "Excel dosyasında geçerli mail adresi bulunamadı. Lütfen ilk sütunda mail adreslerinin olduğundan emin olun.";
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔙 Geri Dön", callback_data: "back_to_main" },
                { text: "🏠 Ana Menü", callback_data: "main_menu" }
              ]
            ]
          }
        };
        
        bot.editMessageText(errorMessage, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard.reply_markup
        });
        // Geçici dosyayı sil
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return;
      }
      
      const successList = emails.join(', ');
      const successMessage = `✅ ${emails.length} mail adresi bulundu:\n\n${successList}`;
      const successKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Onayla", callback_data: "confirm_recipients" }
            ],
            [
              { text: "🔙 Geri Dön", callback_data: "back_to_main" },
              { text: "🏠 Ana Menü", callback_data: "main_menu" }
            ]
          ]
        }
      };

      // Onayı beklemek için geçici alıcı listesini state'e yaz
      saveUserState(userId, 'confirm_recipients', { pendingRecipients: emails });

      // Mevcut kartı güncelle (işleniyor kartı aynı kalır ve yerinde güncellenir)
      const currentId = getUserMessage(userId);
      bot.editMessageText(successMessage, {
        chat_id: chatId,
        message_id: currentId,
        reply_markup: successKeyboard.reply_markup
      });
      
      // Geçici dosyayı sil
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
    } catch (error) {
      console.error('Excel Error:', error);
      const errId = getUserMessage(userId);
      const errorMessage = `Excel dosyası işlenirken hata oluştu: ${error.message}`;
      if (errId) {
        bot.editMessageText(errorMessage, {
          chat_id: chatId,
          message_id: errId,
          reply_markup: {
            inline_keyboard: [[
              { text: "🔙 Geri Dön", callback_data: "back_to_main" },
              { text: "🏠 Ana Menü", callback_data: "main_menu" }
            ]]
          }
        });
      } else {
        bot.sendMessage(chatId, errorMessage);
      }
      
      // Geçici dosyayı temizle
      try {
        const filePath = `./temp_${Date.now()}_${msg.document.file_name}`;
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (cleanupError) {
        console.error('Cleanup Error:', cleanupError);
      }
    }
  } else if (state === 'waiting_attachment') {
    try {
      const fileId = msg.document.file_id;
      const fileName = msg.document.file_name;
      const mimeType = msg.document.mime_type;
      await handleAttachment(bot, chatId, userId, downloadFile, { fileId, fileName, mimeType });
    } catch (error) {
      console.error('Attachment Error (document):', error);
    }
  } else {
    console.log('No matching state for document:', state);
    const messageId = getUserMessage(userId);
    const message = "Dosya göndermek için önce '📎 Dosya Ekle' butonuna basın.";
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔙 Geri Dön", callback_data: "back_to_main" },
            { text: "🏠 Ana Menü", callback_data: "main_menu" }
          ]
        ]
      }
    };
    
    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard.reply_markup
      });
    } else {
      bot.sendMessage(chatId, message, keyboard);
    }
  }
});

// Attachment helpers imported from ./attachments

// Fotoğraf ekleri
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const state = getUserState(userId);
  if (state !== 'waiting_attachment') return;

  try {
    // En büyük çözünürlüklü fotoğrafı seç
    const photos = msg.photo || [];
    const best = photos[photos.length - 1];
    if (!best) return;
    const fileId = best.file_id;
    await handleAttachment(bot, chatId, userId, downloadFile, { fileId, fileName: null, mimeType: 'image/jpeg' });
  } catch (error) {
    console.error('Attachment Error (photo):', error);
  }
});

// Video ekleri
bot.on('video', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const state = getUserState(userId);
  if (state !== 'waiting_attachment') return;

  try {
    const video = msg.video;
    if (!video) return;
    const fileId = video.file_id;
    const mimeType = video.mime_type || 'video/mp4';
    await handleAttachment(bot, chatId, userId, downloadFile, { fileId, fileName: null, mimeType });
  } catch (error) {
    console.error('Attachment Error (video):', error);
  }
});

// GIF/animasyon (ör. .gif)
bot.on('animation', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const state = getUserState(userId);
  if (state !== 'waiting_attachment') return;

  try {
    const anim = msg.animation;
    if (!anim) return;
    const fileId = anim.file_id;
    const mimeType = anim.mime_type || 'image/gif';
    await handleAttachment(bot, chatId, userId, downloadFile, { fileId, fileName: null, mimeType });
  } catch (error) {
    console.error('Attachment Error (animation):', error);
  }
});

console.log('Telegram Mail Bot başlatıldı...');
console.log('⚠️  UYARI: Bu bot asla arka planda çalıştırılmamalıdır!');
console.log('📝 Botu durdurmak için: Ctrl+C veya npm run stop');
