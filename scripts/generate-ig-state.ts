
const { IgApiClient } = require('instagram-private-api');
const { writeFile, readFile } = require('fs').promises;
const { existsSync } = require('fs');
const dotenv = require('dotenv');
const readline = require('readline');

// Load .env.local
dotenv.config({ path: '.env.local' });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const askQuestion = (query: string): Promise<string> =>
  new Promise((resolve) => rl.question(query, resolve));

async function loginAndSave(usernameKey: string, passwordKey: string, filename: string) {
  const username = process.env[usernameKey];
  const password = process.env[passwordKey];

  if (!username || !password) {
    console.error(`Missing ${usernameKey} or ${passwordKey} in .env.local`);
    return;
  }

  console.log(`\n--- Authenticating ${username} ---`);
  const ig = new IgApiClient();
  ig.state.generateDevice(username);

  // function to handle 2fa
  // ...

  try {
    await ig.account.login(username, password);
    console.log(`Logged in as ${username}`);
  } catch (e: any) {
    if (e.message.includes('challenge_required') || e.name === 'IgCheckpointError') {
       console.log('Challenge required. Attempting to resolve...');
       await ig.challenge.auto(true);
       const inputCode = await askQuestion('Input code received via SMS/Email: ');
       await ig.challenge.sendSecurityCode(inputCode);
    } else if (e.name === 'IgLoginTwoFactorRequiredError') {
        const { two_factor_identifier } = e.response.body.two_factor_info;
        // verification code from SMS or authenticator app
        const code = await askQuestion('Enter 2FA code: ');
        // method '1' = TOTP (Auth App), '0' = SMS. Defaulting to '1' (TOTP) as it is common, or '0' if SMS.
        // Actually best to try one or ask. Let's assume SMS '0' if user didn't specify, or TOTP '1'? 
        // Most users uses SMS for IG? Or App. 
        // Let's try '1' (Authenticator App) first as it is more standard for "2FA", SMS is often default login flow.
        // If it fails, script crashes, user runs again? 
        // Let's ask.
        const method = await askQuestion('Is this SMS (0) or Authenticator App (1)? [default: 1]: ') || '1';
        await ig.account.twoFactorLogin({
            username,
            verificationCode: code,
            twoFactorIdentifier: two_factor_identifier, // correct usage
            verificationMethod: method, 
            trustThisDevice: '1', 
        });
    } else {
        throw e;
    }
  }

  const serialized = await ig.state.serialize();
  delete serialized.constants; // Optional cleanup

  await writeFile(filename, JSON.stringify(serialized));
  console.log(`Saved session to ${filename}`);

  // Debug: list saved collections
  console.log('--- Debug: Fetching Collections ---');
  try {
      // Trying the request manually if factory method is obscure
      const collections = await (ig.feed as any).savedCollections().request(); 
      console.log('Collections Found:', collections.items.map((c: any) => `${c.name} (ID: ${c.collection_id})`).join(', '));
  } catch (err: any) {
      console.warn('Could not fetch saved collections via feed.savedCollections():', err.message);
      // Try fallback URL manually
      try {
          const { body } = await ig.request.send({ url: '/api/v1/collections/list/' });
          console.log('Collections Found (API manual):', (body.items || []).map((c: any) => `${c.name} (ID: ${c.collection_id})`).join(', '));
      } catch (err2: any) {
          console.error('Manual collection fetch also failed:', err2.message);
      }
  }
}

async function main() {
    // We need to generate state for BOTH accounts? 
    // Usually the user wants to repost FROM Source To Target.
    // The App needs to login as Source (to read) and Target (to upload).
    // So we should generate two files.
    
    await loginAndSave('IG_SOURCE_USERNAME', 'IG_SOURCE_PASSWORD', 'ig-state-source.json');
    await loginAndSave('IG_TARGET_USERNAME', 'IG_TARGET_PASSWORD', 'ig-state-target.json');

    rl.close();
}

main().catch(console.error);
