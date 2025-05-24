require('dotenv').config();
const { slackGet, slackPost } = require('./slackCLient');
const axios   = require('axios');
const makePrompt = require('./standupPrompt');

async function fetchPrepMessages() {
  const { messages } = await slackGet('conversations.history', {
    channel: process.env.PREP_CHANNEL,
    oldest: (Date.now()/1000 - 24*3600),     // last 24h
  });
  return messages
    .filter(m => !m.subtype)                 // skip bot joins, etc.
    .reverse()                               // oldest first
    .map(m => `${m.user}: ${m.text}`)
    .join('\n');
}

async function postDigest(text) {
  await slackPost('chat.postMessage', {
    channel: process.env.POST_CHANNEL,
    text,
  });
}

async function main() {
  const raw = await fetchPrepMessages();
  if (!raw.trim()) return console.log('No prep messages yet');

  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: makePrompt(raw) }] },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}` } }
  );
  await postDigest(data.choices[0].message.content.trim());
  console.log('✅ Digest posted');
}

if (require.main === module) main();
