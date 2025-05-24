require('dotenv').config();
const axios = require('axios');

const slack = axios.create({
  baseURL: 'https://slack.com/api',
  headers: { Authorization: `Bearer ${process.env.SLACK_TOKEN}` },
});

async function slackGet(method, params) {
  const { data } = await slack.get(method, { params });
  if (!data.ok) throw new Error(data.error);
  return data;
}

async function slackPost(method, body) {
  const { data } = await slack.post(method, body);
  if (!data.ok) throw new Error(data.error);
  return data;
}

module.exports = { slackGet, slackPost };
