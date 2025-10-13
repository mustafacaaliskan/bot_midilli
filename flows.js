const OpenAI = require('openai');
const nodemailer = require('nodemailer');
const config = require('./config');
const { saveUserState, getUserData } = require('./state');
const { replaceCard, updateCard } = require('./ui');

function getOpenAIKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const normalized = String(key).trim();
  if (!normalized) return null;
  return normalized;
}

function getOpenAIClient() {
  const key = getOpenAIKey();
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

// Static footer appended to all outgoing emails and previews
const MAIL_FOOTER = 'Saygılarımla\nHakan Kaya\nEnso YK Üyesi';

function applyFooterToContent(content) {
  const body = content == null ? '' : String(content);
  if (!body.trim()) return MAIL_FOOTER;
  return body.endsWith('\n') ? `${body}\n${MAIL_FOOTER}` : `${body}\n\n${MAIL_FOOTER}`;
}

function escapeTelegramMarkdown(input) {
  if (input == null) return '';
  const str = String(input);
  // Escape Telegram Markdown v1 special characters: _ * ` [
  return str.replace(/([_*`\[])/g, '\\$1');
}

const smtpHost = process.env.SMTP_SERVER || config.SMTP_SERVER;
const smtpPort = parseInt(process.env.SMTP_PORT || config.SMTP_PORT, 10);
const smtpUser = process.env.EMAIL_ADDRESS || config.EMAIL_ADDRESS;
const smtpPassRaw = process.env.EMAIL_PASSWORD || config.EMAIL_PASSWORD;
const smtpPass = (smtpPassRaw || '').replace(/\s+/g, ''); // Trim and remove spaces (Gmail app passwords)
const smtpSecure = smtpPort === 465; // 465: SSL, 587: STARTTLS

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: { user: smtpUser, pass: smtpPass },
});

async function createWithAI(bot, chatId, userId, callbackMessageId = null) {
  const openai = getOpenAIClient();
  if (!openai) {
    const { replaceCard, updateCard } = require('./ui');
    const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
    const message = "Yapay zeka özelliği yapılandırılmamış. Lütfen yöneticiye bildirin.";
    if (callbackMessageId) {
      await updateCard(bot, chatId, userId, message, keyboard);
    } else {
      await replaceCard(bot, chatId, userId, message, keyboard);
    }
    return;
  }
  saveUserState(userId, 'ai_subject');
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
  if (callbackMessageId) {
    await updateCard(bot, chatId, userId, "Mail konusunu girin:", keyboard);
  } else {
    const msg = await bot.sendMessage(chatId, "Mail konusunu girin:", keyboard);
    const { saveUserMessage } = require('./state');
    saveUserMessage(userId, msg.message_id);
  }
}

async function processAISubject(bot, chatId, userId, subject) {
  const data = getUserData(userId);
  saveUserState(userId, 'ai_content', { ...data, subject });
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
  await replaceCard(bot, chatId, userId, "Mail içeriği hakkında kısaca ne yazmak istediğinizi belirtin:", keyboard);
}

async function processAIContent(bot, chatId, userId, content) {
  saveUserState(userId, 'ai_tone', { content });
  const keyboard = { reply_markup: { inline_keyboard: [
    [{ text: "Resmi", callback_data: "tone_formal" }, { text: "Samimi", callback_data: "tone_friendly" }],
    [{ text: "Profesyonel", callback_data: "tone_professional" }, { text: "Casual", callback_data: "tone_casual" }],
    [{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]
  ] } };
  await replaceCard(bot, chatId, userId, "Mail hangi tonda yazılsın?", keyboard);
}

async function processAITone(bot, chatId, userId, tone) {
  const openai = getOpenAIClient();
  if (!openai) {
    const { replaceCard } = require('./ui');
    await replaceCard(bot, chatId, userId, "Yapay zeka özelliği yapılandırılmamış.", { reply_markup: { inline_keyboard: [[{ text: "🏠 Ana Menü", callback_data: "main_menu" }]] } });
    return;
  }
  const data = getUserData(userId);
  const { subject, content } = data;
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
  try {
    const processingMsg = await replaceCard(bot, chatId, userId, "Yapay zeka mail içeriğini oluşturuyor, lütfen bekleyin...", keyboard);
    const prompt = `Aşağıdaki bilgilere göre ${tone} tonda bir email yaz:\nKonu: ${subject}\nİçerik: ${content}\nTon: ${tone}\n\nEmail'i Türkçe olarak yaz ve profesyonel bir format kullan.`;
    const completion = await openai.chat.completions.create({ model: "gpt-3.5-turbo", messages: [{ role: "user", content: prompt }], max_tokens: 1000 });
    const emailContent = completion.choices[0].message.content;
    saveUserState(userId, 'email_ready', { subject, content: emailContent, method: 'ai' });
    const { showEmailPreview } = require('./flows');
    showEmailPreview(bot, chatId, userId, subject, emailContent, processingMsg.message_id);
  } catch (error) {
    console.error('OpenAI Error:', error);
    await replaceCard(bot, chatId, userId, "Yapay zeka ile mail oluşturulurken hata oluştu. Lütfen tekrar deneyin.", keyboard);
    const { getUserMessage } = require('./state');
    setTimeout(() => require('./ui').showMainMenu(bot, chatId, userId, getUserMessage(userId)), 2000);
  }
}

async function createManual(bot, chatId, userId, callbackMessageId = null) {
  saveUserState(userId, 'manual_subject');
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
  if (callbackMessageId) {
    await updateCard(bot, chatId, userId, "Mail konusunu girin:", keyboard);
  } else {
    const msg = await bot.sendMessage(chatId, "Mail konusunu girin:", keyboard);
    const { saveUserMessage } = require('./state');
    saveUserMessage(userId, msg.message_id);
  }
}

async function processManualSubject(bot, chatId, userId, subject) {
  const data = getUserData(userId);
  saveUserState(userId, 'manual_content', { ...data, subject });
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
  await replaceCard(bot, chatId, userId, "Mail içeriğini girin:", keyboard);
}

async function processManualContent(bot, chatId, userId, content) {
  const data = getUserData(userId);
  const { subject } = data;
  saveUserState(userId, 'email_ready', { subject, content, method: 'manual' });
  await showEmailPreview(bot, chatId, userId, subject, content);
}

async function showTemplates(bot, chatId, userId, messageId = null) {
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "📅 Toplantı Hatırlatması", callback_data: "template_meeting_reminder" }]] } };
  const message = "Hangi şablonu kullanmak istiyorsunuz?";
  if (messageId) {
    await updateCard(bot, chatId, userId, message, keyboard);
  } else {
    const msg = await bot.sendMessage(chatId, message, keyboard);
    const { saveUserMessage } = require('./state');
    saveUserMessage(userId, msg.message_id);
  }
}

async function processTemplate(bot, chatId, userId, template) {
  if (template) {
    saveUserState(userId, 'email_ready', { subject: template.subject, content: template.content, method: 'template' });
    await showEmailPreview(bot, chatId, userId, template.subject, template.content);
  }
}

async function showEmailPreview(bot, chatId, userId, subject, content) {
  const data = getUserData(userId);
  const attachments = data.attachments || [];
  const keyboard = { reply_markup: { inline_keyboard: [
    [{ text: "✏️ Düzenle", callback_data: "edit_email" }, { text: "📎 Dosya Ekle", callback_data: "add_attachment" }],
    [{ text: "➡️ Alıcıları Belirle", callback_data: "set_recipients" }]
  ] } };
  const escSubject = escapeTelegramMarkdown(subject);
  const withFooter = applyFooterToContent(content);
  const escContent = escapeTelegramMarkdown(withFooter);
  let preview = `📧 **Mail Önizlemesi**\n\n**Konu:** ${escSubject}\n\n**İçerik:**\n${escContent}`;
  if (attachments.length > 0) {
    const files = attachments.map((f, i) => `${i + 1}. ${escapeTelegramMarkdown(f.name)}`).join('\n');
    preview += `\n\n**📎 Eklenen Dosyalar:**\n${files}`;
  }
  preview += `\n\nMail hazır! Ne yapmak istiyorsunuz?`;
  await replaceCard(bot, chatId, userId, preview, { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });
}

async function editEmail(bot, chatId, userId) {
  const data = getUserData(userId);
  saveUserState(userId, 'editing_email');
  const message = `Mevcut mail içeriği:\n\n${data.content}\n\nDüzenlenmiş içeriği gönderin:`;
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
  await replaceCard(bot, chatId, userId, message, keyboard);
}

async function processEditedEmail(bot, chatId, userId, newContent) {
  const data = getUserData(userId);
  saveUserState(userId, 'email_ready', { ...data, content: newContent });
  await showEmailPreview(bot, chatId, userId, data.subject, newContent);
}

async function showRecipientOptions(bot, chatId, userId) {
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "📊 Excel ile Toplu", callback_data: "recipients_excel" }], [{ text: "✍️ Manuel Gir", callback_data: "recipients_manual" }]] } };
  const message = "Alıcıları nasıl belirlemek istiyorsunuz?";
  await replaceCard(bot, chatId, userId, message, keyboard);
}

async function processExcelRecipients(bot, chatId, userId) {
  saveUserState(userId, 'waiting_excel');
  const message = "Excel dosyasını gönderin. Dosyada ilk sütundaki ikinci satırdan itibaren mail adresleri olmalı.";
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
  await replaceCard(bot, chatId, userId, message, keyboard);
}

async function processManualRecipients(bot, chatId, userId) {
  saveUserState(userId, 'manual_recipients');
  const message = "Mail adreslerini alt alta yazın (her satıra bir mail adresi):";
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
  await replaceCard(bot, chatId, userId, message, keyboard);
}

async function processRecipients(bot, chatId, userId, recipients) {
  const data = getUserData(userId);
  saveUserState(userId, 'ready_to_send', { ...data, recipients });
  await showFinalPreview(bot, chatId, userId);
}

async function showFinalPreview(bot, chatId, userId) {
  const data = getUserData(userId);
  const { subject, content, recipients } = data;
  const escSubject = escapeTelegramMarkdown(subject);
  const withFooter = applyFooterToContent(content);
  const escContent = escapeTelegramMarkdown(withFooter);
  const escRecipients = (recipients || []).map(r => escapeTelegramMarkdown(r)).join(', ');
  const preview = `📧 **Son Mail Önizlemesi**\n\n**Konu:** ${escSubject}\n\n**Alıcılar:** ${escRecipients}\n\n**İçerik:**\n${escContent}\n\nMaili göndermek istiyor musunuz?`;
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "✅ Gönder", callback_data: "send_email" }, { text: "❌ İptal", callback_data: "cancel" }]] } };
  await replaceCard(bot, chatId, userId, preview, { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });
}

async function sendEmail(bot, chatId, userId) {
  const data = getUserData(userId);
  const { subject, content, recipients, attachments = [] } = data;
  const { getUserMessage, clearUserState } = require('./state');
  const messageId = getUserMessage(userId);
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
  try {
    bot.editMessageText("Mail gönderiliyor...", { chat_id: chatId, message_id: messageId, reply_markup: keyboard.reply_markup });
    const mailOptions = { from: smtpUser, to: recipients.join(', '), subject, text: applyFooterToContent(content) };
    if (attachments.length > 0) {
      mailOptions.attachments = attachments.map(file => ({ filename: file.name, content: file.content, contentType: file.mimeType }));
    }
    await transporter.sendMail(mailOptions);
    bot.editMessageText(`✅ Mail başarıyla gönderildi!\n\nAlıcılar: ${recipients.join(', ')}`, { chat_id: chatId, message_id: messageId, reply_markup: keyboard.reply_markup });
    clearUserState(userId);
    setTimeout(() => require('./ui').showMainMenu(bot, chatId, userId, messageId), 2000);
  } catch (error) {
    console.error('Email Error:', error);
    bot.editMessageText("Mail gönderilirken hata oluştu. Lütfen tekrar deneyin.", { chat_id: chatId, message_id: messageId, reply_markup: keyboard.reply_markup });
  }
}

module.exports = {
  createWithAI,
  processAISubject,
  processAIContent,
  processAITone,
  createManual,
  processManualSubject,
  processManualContent,
  showTemplates,
  processTemplate,
  showEmailPreview,
  editEmail,
  processEditedEmail,
  showRecipientOptions,
  processExcelRecipients,
  processManualRecipients,
  processRecipients,
  showFinalPreview,
  sendEmail,
};

// Back navigation helper: decide previous step and render it
async function goBack(bot, chatId, userId) {
  const { getUserState, getUserData, saveUserState } = require('./state');
  const { updateCard, replaceCard } = require('./ui');
  const state = getUserState(userId);
  const data = getUserData(userId);

  switch (state) {
    case 'ai_content': {
      saveUserState(userId, 'ai_subject');
      const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
      await updateCard(bot, chatId, userId, "Mail konusunu girin:", keyboard);
      return;
    }
    case 'ai_tone': {
      saveUserState(userId, 'ai_content', { subject: data.subject, content: data.content });
      const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
      await updateCard(bot, chatId, userId, "Mail içeriği hakkında kısaca ne yazmak istediğinizi belirtin:", keyboard);
      return;
    }
    case 'editing_email': {
      // Return to preview
      saveUserState(userId, 'email_ready', data);
      await showEmailPreview(bot, chatId, userId, data.subject, data.content);
      return;
    }
    case 'waiting_attachment': {
      // Cancel attachment add and go back to preview
      saveUserState(userId, 'email_ready', data);
      await showEmailPreview(bot, chatId, userId, data.subject, data.content);
      return;
    }
    case 'waiting_excel':
    case 'manual_recipients': {
      // Back to recipient options
      await showRecipientOptions(bot, chatId, userId);
      return;
    }
    case 'ready_to_send': {
      // Back to email preview step
      saveUserState(userId, 'email_ready', data);
      await showEmailPreview(bot, chatId, userId, data.subject, data.content);
      return;
    }
    case 'email_ready': {
      // Decide based on method
      const method = data.method;
      if (method === 'ai') {
        saveUserState(userId, 'ai_tone', { subject: data.subject, content: data.content });
        const keyboard = { reply_markup: { inline_keyboard: [
          [{ text: "Resmi", callback_data: "tone_formal" }, { text: "Samimi", callback_data: "tone_friendly" }],
          [{ text: "Profesyonel", callback_data: "tone_professional" }, { text: "Casual", callback_data: "tone_casual" }],
          [{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]
        ] } };
        await updateCard(bot, chatId, userId, "Mail hangi tonda yazılsın?", keyboard);
        return;
      }
      if (method === 'manual') {
        saveUserState(userId, 'manual_content', { subject: data.subject });
        const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
        await updateCard(bot, chatId, userId, "Mail içeriğini girin:", keyboard);
        return;
      }
      if (method === 'template') {
        await showTemplates(bot, chatId, userId, require('./state').getUserMessage(userId));
        return;
      }
      break;
    }
    default:
      break;
  }
  // Fallback to main menu
  await require('./ui').showMainMenu(bot, chatId, userId, require('./state').getUserMessage(userId));
}

module.exports.goBack = goBack;


