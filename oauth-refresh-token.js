const { google } = require('googleapis');
const http = require('http');
const { URL } = require('url');

// Fill these before running or pass via env (recommended):
// export GMAIL_CLIENT_ID=...; export GMAIL_CLIENT_SECRET=...
const CLIENT_ID = process.env.GMAIL_CLIENT_ID || 'YOUR_CLIENT_ID';
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';

// Desktop flow with a local HTTP callback to reliably capture the code
// We'll bind to a random available port
function getRedirectUri(port) {
  return `http://localhost:${port}/oauth2callback`;
}
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

async function main() {
  if (!CLIENT_ID || CLIENT_ID === 'YOUR_CLIENT_ID' || !CLIENT_SECRET || CLIENT_SECRET === 'YOUR_CLIENT_SECRET') {
    console.log('Please set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET env vars or edit this file.');
    process.exit(1);
  }

  // Start a tiny local server to receive the OAuth callback
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${server.address().port}`);
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing code');
        return;
      }
      const oAuth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, getRedirectUri(server.address().port));
      const { tokens } = await oAuth2.getToken(code);
      const refresh = tokens.refresh_token;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      if (!refresh) {
        res.end('No refresh_token returned. Ensure prompt=consent & access_type=offline. You can close this tab.');
      } else {
        res.end('Refresh token captured successfully! You can close this tab.');
      }
      server.close(() => {
        if (!refresh) {
          console.error('No refresh_token returned. Ensure you used prompt=consent and access_type=offline.');
          process.exit(1);
        }
        console.log('\n✅ GMAIL_REFRESH_TOKEN =', refresh);
        console.log('\n📝 Add to your environment variables (e.g., Railway):');
        console.log('GMAIL_REFRESH_TOKEN=' + refresh);
        console.log('\n⚠️  Note: Refresh tokens typically expire after 6 months of inactivity.');
        console.log('   If you get "invalid_grant" errors, run this script again to get new tokens.');
        process.exit(0);
      });
    } catch (e) {
      console.error('Callback error:', e && e.message ? e.message : e);
      try { res.writeHead(500); res.end('Error'); } catch (_) {}
      server.close(() => process.exit(1));
    }
  });

  server.listen(0, () => {
    const port = server.address().port;
    const redirectUri = getRedirectUri(port);
    const oAuth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, redirectUri);
    const url = oAuth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
    console.log('\nOpen this URL in your browser and authorize:\n');
    console.log(url);
    console.log(`\nAfter approving, you will be redirected to ${redirectUri}. The script will capture the code automatically.`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


