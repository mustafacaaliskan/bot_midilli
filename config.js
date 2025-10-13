// Bot configuration file
// Copy this file to .env and fill in your actual values

module.exports = {
  // Telegram Bot Configuration
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'your_telegram_bot_token_here',
  
  // OpenAI Configuration
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'your_openai_api_key_here',
  
  // Email Configuration (SMTP)
  SMTP_SERVER: process.env.SMTP_SERVER || 'smtp.gmail.com',
  SMTP_PORT: process.env.SMTP_PORT || 587,
  EMAIL_ADDRESS: process.env.EMAIL_ADDRESS || 'your_email@gmail.com',
  EMAIL_PASSWORD: process.env.EMAIL_PASSWORD || 'your_app_password_here',
  
  // Admin User IDs (comma separated)
  ADMIN_USER_IDS: process.env.ADMIN_USER_IDS || 'your_telegram_user_id_here'
};
