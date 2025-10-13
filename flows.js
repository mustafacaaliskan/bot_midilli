const OpenAI = require('openai');
const nodemailer = require('nodemailer');
const config = require('./config');
const { saveUserState, getUserData } = require('./state');
const { getUserMessage } = require('./state');
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

// Removed blink behavior per requirement: no visual blinking around cards/buttons

const smtpHost = process.env.SMTP_SERVER || config.SMTP_SERVER;
const smtpPort = parseInt(process.env.SMTP_PORT || config.SMTP_PORT, 10);
const smtpUser = process.env.EMAIL_ADDRESS || config.EMAIL_ADDRESS;
const smtpPassRaw = process.env.EMAIL_PASSWORD || config.EMAIL_PASSWORD;
const smtpPass = (smtpPassRaw || '').replace(/\s+/g, ''); // Trim and remove spaces (Gmail app passwords)
// Prefer STARTTLS on 587 for Railway; 465 (implicit SSL) often blocked
const smtpSecure = smtpPort === 465; // 465: SSL, 587: STARTTLS

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  // Hint Nodemailer to use Gmail presets when applicable
  service: /(^|\.)gmail\.com$/i.test(String(smtpHost || '')) ? 'gmail' : undefined,
  auth: { user: smtpUser, pass: smtpPass },
  authMethod: 'LOGIN',
  // Use a small pool and keepalive for stability on PaaS
  pool: true,
  maxConnections: 1,
  maxMessages: 5,
  keepAlive: true,
  // Increase timeouts to mitigate slow networks
  connectionTimeout: 20000, // 20s
  greetingTimeout: 20000,   // 20s
  socketTimeout: 30000,     // 30s
  // For STARTTLS (587), require TLS to avoid downgrade
  requireTLS: smtpPort === 587,
  // Enforce modern TLS to satisfy Gmail and some host firewalls
  tls: { minVersion: 'TLSv1.2' },
  // Prefer IPv4 on hosts where IPv6 connectivity is flaky (e.g., some PaaS)
  family: 4,
});

function timeoutPromise(ms) {
  return new Promise((_, reject) => {
    const err = new Error(`Timeout after ${ms}ms`);
    err.code = 'ETIMEOUT';
    setTimeout(() => reject(err), ms);
  });
}

async function verifySMTP() {
  try {
    // Verify with an upper bound so we don't hang forever
    await Promise.race([transporter.verify(), timeoutPromise(12000)]);
    return true;
  } catch (e) {
    console.error('SMTP verify failed:', e && (e.code || e.name), e && e.message);
    return false;
  }
}

async function sendViaSMTP(mailOptions) {
  return transporter.sendMail(mailOptions);
}

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
    const prompt = `Türkçe kısa ve net bir e-posta yaz.\nKonu: "${subject}"\nİstek: "${content}"\nTon: ${tone}\nGereksinimler: profesyonel, selamlama + gövde; imza/alt bilgi ekleme.`;
    const completion = await openai.chat.completions.create({ model: "gpt-3.5-turbo", messages: [{ role: "user", content: prompt }], max_tokens: 400 });
    const emailContent = completion.choices[0].message.content;
    saveUserState(userId, 'email_ready', { subject, content: emailContent, method: 'ai', aiBrief: content, aiTone: tone });
    const { showEmailPreview } = require('./flows');
    showEmailPreview(bot, chatId, userId, subject, emailContent, processingMsg.message_id);
    // no blink
  } catch (error) {
    console.error('OpenAI Error:', error);
    await replaceCard(bot, chatId, userId, "Yapay zeka ile mail oluşturulurken hata oluştu. Lütfen tekrar deneyin.", keyboard);
    const { getUserMessage } = require('./state');
    setTimeout(() => require('./ui').showMainMenu(bot, chatId, userId, getUserMessage(userId)), 2000);
    // no blink
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
  // Mark current step for proper back navigation
  const { saveUserState, getUserState } = require('./state');
  const current = getUserState(userId);
  // If entering from Main Menu (no current state), seed history with a main_menu sentinel
  if (!current) {
    saveUserState(userId, 'main_menu');
  }
  saveUserState(userId, 'template_select');
  const keyboard = { reply_markup: { inline_keyboard: [
    [{ text: "📅 Toplantı Hatırlatması", callback_data: "template_meeting_reminder" }],
    [{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]
  ] } };
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
  const rows = [];
  rows.push([{ text: "✏️ Düzenle", callback_data: "edit_email" }, { text: "📎 Dosya Ekle", callback_data: "add_attachment" }]);
  if (data.method === 'ai') {
    rows.push([{ text: "🔄 Yeniden Üret", callback_data: "regenerate_email" }]);
  }
  rows.push([{ text: "➡️ Alıcıları Belirle", callback_data: "set_recipients" }]);
  rows.push([{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]);
  const keyboard = { reply_markup: { inline_keyboard: rows } };
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
  // Mark step for back navigation to email preview
  const { saveUserState } = require('./state');
  saveUserState(userId, 'choose_recipients');
  const keyboard = { reply_markup: { inline_keyboard: [
    [{ text: "📊 Excel ile Toplu", callback_data: "recipients_excel" }],
    [{ text: "✍️ Manuel Gir", callback_data: "recipients_manual" }],
    [{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]
  ] } };
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
  const keyboard = { reply_markup: { inline_keyboard: [
    [{ text: "✅ Gönder", callback_data: "send_email" }],
    [{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]
  ] } };
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

    const ok = await verifySMTP();
    if (!ok) throw new Error('SMTP doğrulama başarısız.');
    await sendViaSMTP(mailOptions);

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
  const { getUserState, getUserData, popUserState, saveUserState } = require('./state');
  const { updateCard } = require('./ui');
  const current = getUserState(userId);
  const data = getUserData(userId);

  // Pop exactly one previous state
  const prev = popUserState(userId);
  if (!prev) {
    await require('./ui').showMainMenu(bot, chatId, userId, require('./state').getUserMessage(userId));
    return;
  }

  // Special-case: if entering Manual flow directly after Templates, treat Back as Main Menu
  if (current === 'manual_subject' && prev === 'template_select') {
    await require('./ui').showMainMenu(bot, chatId, userId, require('./state').getUserMessage(userId));
    return;
  }

  switch (prev) {
    case 'template_select': {
      await module.exports.showTemplates(bot, chatId, userId, require('./state').getUserMessage(userId));
      return;
    }
    case 'main_menu': {
      await require('./ui').showMainMenu(bot, chatId, userId, require('./state').getUserMessage(userId));
      return;
    }
    case 'choose_recipients': {
      // Return to email preview with current data
      const subj = data.subject;
      const cont = data.content;
      await showEmailPreview(bot, chatId, userId, subj, cont);
      return;
    }
    case 'ai_subject': {
      const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
      await updateCard(bot, chatId, userId, "Mail konusunu girin:", keyboard);
      return;
    }
    case 'ai_content': {
      const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
      await updateCard(bot, chatId, userId, "Mail içeriği hakkında kısaca ne yazmak istediğinizi belirtin:", keyboard);
      return;
    }
    case 'ai_tone': {
      const keyboard = { reply_markup: { inline_keyboard: [
        [{ text: "Resmi", callback_data: "tone_formal" }, { text: "Samimi", callback_data: "tone_friendly" }],
        [{ text: "Profesyonel", callback_data: "tone_professional" }, { text: "Casual", callback_data: "tone_casual" }],
        [{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]
      ] } };
      await updateCard(bot, chatId, userId, "Mail hangi tonda yazılsın?", keyboard);
      return;
    }
    case 'email_ready': {
      await showEmailPreview(bot, chatId, userId, data.subject, data.content);
      return;
    }
    case 'waiting_attachment': {
      await showEmailPreview(bot, chatId, userId, data.subject, data.content);
      return;
    }
    case 'waiting_excel':
    case 'manual_recipients': {
      await showRecipientOptions(bot, chatId, userId);
      return;
    }
    // no-op for removed transitional states
    case 'confirm_recipients': {
      // Re-render the confirmation screen using pendingRecipients if exists
      const emails = Array.isArray(data?.pendingRecipients) ? data.pendingRecipients : [];
      const successList = emails.join(', ');
      const successMessage = `✅ ${emails.length} mail adresi bulundu:\n\n${successList}`;
      const successKeyboard = { reply_markup: { inline_keyboard: [
        [{ text: "✅ Onayla", callback_data: "confirm_recipients" }],
        [{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]
      ] } };
      await updateCard(bot, chatId, userId, successMessage, successKeyboard);
      return;
    }
    case 'ready_to_send': {
      await showFinalPreview(bot, chatId, userId);
      return;
    }
    case 'manual_content': {
      const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
      await updateCard(bot, chatId, userId, "Mail içeriğini girin:", keyboard);
      return;
    }
    case 'manual_subject': {
      const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
      await updateCard(bot, chatId, userId, "Mail konusunu girin:", keyboard);
      return;
    }
    default:
      break;
  }
  await require('./ui').showMainMenu(bot, chatId, userId, require('./state').getUserMessage(userId));
}

module.exports.goBack = goBack;

// Regenerate AI email with the same subject/brief/tone
module.exports.regenerateAIEmail = async function regenerateAIEmail(bot, chatId, userId) {
  const openai = getOpenAIClient();
  const data = getUserData(userId);
  const subject = data.subject;
  const brief = data.aiBrief || '';
  const tone = data.aiTone || 'profesyonel';
  const keyboard = { reply_markup: { inline_keyboard: [[{ text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" }]] } };
  if (!openai) {
    await replaceCard(bot, chatId, userId, "Yapay zeka özelliği yapılandırılmamış.", keyboard);
    return;
  }
  try {
    await replaceCard(bot, chatId, userId, "Yapay zeka mail içeriğini yeniden oluşturuyor, lütfen bekleyin...", keyboard);
    const prompt = `Türkçe kısa ve net bir e-posta yaz.\nKonu: "${subject}"\nİstek: "${brief}"\nTon: ${tone}\nGereksinimler: profesyonel, selamlama + gövde; imza/alt bilgi ekleme.`;
    const completion = await openai.chat.completions.create({ model: "gpt-3.5-turbo", messages: [{ role: "user", content: prompt }], max_tokens: 400 });
    const emailContent = completion.choices[0].message.content;
    saveUserState(userId, 'email_ready', { ...data, subject, content: emailContent, method: 'ai', aiBrief: brief, aiTone: tone });
    await module.exports.showEmailPreview(bot, chatId, userId, subject, emailContent);
    // no blink
  } catch (error) {
    console.error('OpenAI Error (regenerate):', error);
    await replaceCard(bot, chatId, userId, "Yapay zeka ile mail yeniden oluşturulurken hata oluştu. Lütfen tekrar deneyin.", keyboard);
    // no blink
  }
};


