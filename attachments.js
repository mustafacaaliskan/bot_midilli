const path = require('path');
const { getUserMessage, saveUserMessage, getUserData, saveUserState, setLastInteraction } = require('./state');

async function handleAttachment(bot, chatId, userId, downloadFile, { fileId, fileName, mimeType }) {
  const previousMessageId = getUserMessage(userId);

  const attachmentKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [ { text: "🔙 Geri Dön", callback_data: "back_to_main" }, { text: "🏠 Ana Menü", callback_data: "main_menu" } ]
      ]
    }
  };

  const processingMsg = await bot.sendMessage(chatId, "📎 Dosya işleniyor, lütfen bekleyin...", attachmentKeyboard);
  // Yeni (alt) mesajı kart olarak kaydet
  saveUserMessage(userId, processingMsg.message_id);
  // Eski üst mesajı sil, üstteki akışı kes
  if (previousMessageId) {
    try { await bot.deleteMessage(chatId, previousMessageId); } catch (e) { console.log('Could not delete previous message:', e.message); }
  }

  const file = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const fileContent = await downloadFile(fileUrl);

  const resolvedFileName = fileName || path.basename(file.file_path || `file_${Date.now()}`);
  const resolvedMimeType = mimeType || inferMimeTypeFromPath(file.file_path || resolvedFileName);

  const currentUserData = getUserData(userId);
  const attachments = currentUserData.attachments || [];
  attachments.push({ name: resolvedFileName, content: fileContent, mimeType: resolvedMimeType });

  saveUserState(userId, 'email_ready', { ...currentUserData, attachments });

  // Alt karttan devam: preview'u aynı mesaj üzerinden güncellemek için callback olarak işaretle
  setLastInteraction(userId, 'callback');
  const updated = getUserData(userId);
  try {
    const { showEmailPreview } = require('./flows');
    await showEmailPreview(bot, chatId, userId, updated.subject, updated.content);
  } catch (e) {
    console.log('Preview update error:', e.message);
  }
}

function inferMimeTypeFromPath(p) {
  const ext = (p || '').toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'pdf':
      return 'application/pdf';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'mkv':
      return 'video/x-matroska';
    default:
      return 'application/octet-stream';
  }
}

module.exports = { handleAttachment, inferMimeTypeFromPath };


