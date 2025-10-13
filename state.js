// State management for users and messages

const userStates = new Map();
const userData = new Map();
const userMessages = new Map();
const userLastInteraction = new Map(); // 'message' | 'callback'

function saveUserState(userId, state, data = {}) {
  userStates.set(userId, state);
  if (Object.keys(data).length > 0) {
    userData.set(userId, { ...userData.get(userId), ...data });
  }
}

function getUserState(userId) {
  return userStates.get(userId);
}

function getUserData(userId) {
  return userData.get(userId) || {};
}

function clearUserState(userId) {
  userStates.delete(userId);
  userData.delete(userId);
  userMessages.delete(userId);
  userLastInteraction.delete(userId);
}

function saveUserMessage(userId, messageId) {
  userMessages.set(userId, messageId);
}

function getUserMessage(userId) {
  return userMessages.get(userId);
}

function setLastInteraction(userId, kind) {
  userLastInteraction.set(userId, kind);
}

function getLastInteraction(userId) {
  return userLastInteraction.get(userId);
}

module.exports = {
  saveUserState,
  getUserState,
  getUserData,
  clearUserState,
  saveUserMessage,
  getUserMessage,
  setLastInteraction,
  getLastInteraction,
};


