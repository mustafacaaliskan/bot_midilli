// Card helpers: replaceCard, updateCard, showMainMenu
const { getUserMessage, saveUserMessage, getLastInteraction } = require('./state');
const config = require('./config');

function isOpenAIConfigured() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return false;
  const normalized = String(key).trim();
  if (!normalized) return false;
  return true;
}

async function replaceCard(bot, chatId, userId, newMessage, options) {
  const oldMessageId = getUserMessage(userId);
  const last = getLastInteraction(userId);

  if (last === 'callback' && oldMessageId) {
    await updateCard(bot, chatId, userId, newMessage, options);
    return { message_id: getUserMessage(userId) };
  }

  if (oldMessageId) {
    try { await bot.deleteMessage(chatId, oldMessageId); } catch (error) { console.log('Could not delete old message:', error.message); }
  }

  const newMsg = await bot.sendMessage(chatId, newMessage, options);
  saveUserMessage(userId, newMsg.message_id);
  return newMsg;
}

async function updateCard(bot, chatId, userId, newMessage, options) {
  const messageId = getUserMessage(userId);
  if (messageId) {
    try {
      await bot.editMessageText(newMessage, { chat_id: chatId, message_id: messageId, ...(options || {}) });
    } catch (error) {
      console.log('Could not update message:', error.message);
      const newMsg = await bot.sendMessage(chatId, newMessage, options);
      saveUserMessage(userId, newMsg.message_id);
      try { await bot.deleteMessage(chatId, messageId); } catch (delErr) { console.log('Could not delete stale message after failed edit:', delErr.message); }
    }
  } else {
    const newMsg = await bot.sendMessage(chatId, newMessage, options);
    saveUserMessage(userId, newMsg.message_id);
  }
}

async function showMainMenu(bot, chatId, userId, messageId = null) {
  const rows = [];
  if (isOpenAIConfigured()) {
    rows.push([ { text: "🤖 Yapay Zeka ile Oluştur", callback_data: "create_ai" } ]);
  }
  rows.push([ { text: "✍️ Manuel Oluştur", callback_data: "create_manual" } ]);
  rows.push([ { text: "📋 Şablonlardan Seç", callback_data: "create_template" } ]);
  const keyboard = { reply_markup: { inline_keyboard: rows } };
  const message = "Mail oluşturmak için bir yöntem seçin:";
  if (messageId) {
    await updateCard(bot, chatId, userId, message, keyboard);
  } else {
    const msg = await bot.sendMessage(chatId, message, keyboard);
    saveUserMessage(userId, msg.message_id);
  }
}

module.exports = { replaceCard, updateCard, showMainMenu };


