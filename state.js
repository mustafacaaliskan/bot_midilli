// State management for users and messages

const userStates = new Map();
const userData = new Map();
const userMessages = new Map();
const userLastInteraction = new Map(); // 'message' | 'callback'
const userBlinkIntervals = new Map();
const userHistory = new Map(); // stack of previous states per user

function saveUserState(userId, state, data = {}) {
  const current = userStates.get(userId);
  if (current && current !== state) {
    const hist = userHistory.get(userId) || [];
    hist.push(current);
    userHistory.set(userId, hist);
  }
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
  userHistory.delete(userId);
  const intId = userBlinkIntervals.get(userId);
  if (intId) {
    clearInterval(intId);
  }
  userBlinkIntervals.delete(userId);
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

function setBlinkInterval(userId, intervalId) {
  const existing = userBlinkIntervals.get(userId);
  if (existing) clearInterval(existing);
  userBlinkIntervals.set(userId, intervalId);
}

function clearBlinkInterval(userId) {
  const existing = userBlinkIntervals.get(userId);
  if (existing) clearInterval(existing);
  userBlinkIntervals.delete(userId);
}

function getBlinkInterval(userId) {
  return userBlinkIntervals.get(userId);
}

function popUserState(userId) {
  const hist = userHistory.get(userId) || [];
  if (hist.length === 0) return null;
  const prev = hist.pop();
  userHistory.set(userId, hist);
  if (prev) {
    userStates.set(userId, prev);
  }
  return prev || null;
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
  setBlinkInterval,
  clearBlinkInterval,
  getBlinkInterval,
  popUserState,
};


