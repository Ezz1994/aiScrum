require("dotenv").config();
const axios = require("axios");
const JIRA = `https://${process.env.JIRA_DOMAIN}`;

async function main() {
  // 1 — Ask robot for a greeting
  const ai = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    { model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Give me one funny greeting" }] },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}` } }
  );
  const greeting = ai.data.choices[0].message.content.trim();

  // 2 — Make a tiny Task in Jira (change DEMO to your project key)
  await axios.post(
    `${JIRA}/rest/api/3/issue`,
    { fields: { project: { key: "SCRUM" },
                summary: greeting,
                issuetype: { name: "Task" } } },
    { auth: { username: process.env.JIRA_EMAIL, password: process.env.JIRA_TOKEN } }
  );

  console.log("Created a Jira ticket titled:", greeting);
}
main();
