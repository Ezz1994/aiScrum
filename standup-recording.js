require('dotenv').config();
const axios = require('axios');
const { slackGet, slackPost } = require('./slackCLient');   // reuse helper
const makePrompt = require('./standupPrompt');

// 1️⃣  Find the most recent Otter file DM
async function fetchLatestTranscript() {
  // files.list cannot filter by sender, so we'll grab last 20 files in DMs
  const { files, paging } = await slackGet('files.list', {
    user: 'U02EL0XC88H',   // hard-coded OtterBot user ID (value as of 2025)
    types: 'documents',
    count: 20
  });

  if (!files?.length) return null;

  const otterFile = files[0];            // newest first
  const dlUrl = otterFile.url_private_download;
  const txt = await axios.get(dlUrl, {
    headers: { Authorization: `Bearer ${process.env.SLACK_TOKEN}` },
    responseType: 'text'
  }).then(r => r.data);

  return txt;
}

// 2️⃣  Clean the transcript (remove timestamps etc.)
function cleanTranscript(txt) {
  return txt
    .replace(/[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3} --> .*/g, '')  // SRT style
    .replace(/<[^>]+>/g, '')            // angle-bracket tags
    .replace(/\s*\n\s*\n+/g, '\n')      // squeeze blank lines
    .trim();
}

// 3️⃣  Post digest to Slack
async function postDigest(text) {
  await slackPost('chat.postMessage', {
    channel: process.env.POST_CHANNEL,
    text
  });
}

async function main() {
  const raw = await fetchLatestTranscript();
  if (!raw) { console.log('Transcript not found yet'); return; }

  const plain = cleanTranscript(raw);
  if (!plain) { console.log('Transcript empty'); return; }

  // GPT summary
  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: makePrompt(plain) }]
    },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}` } }
  );

  const digest = data.choices[0].message.content.trim();
  await postDigest(digest);
  console.log('✅ Digest posted from transcript');
}

if (require.main === module) main();
module.exports = { fetchLatestTranscript, cleanTranscript };
