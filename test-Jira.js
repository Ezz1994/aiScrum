require("dotenv").config();
const axios = require("axios");
const JIRA = `https://${process.env.JIRA_DOMAIN}`;

(async () => {
  const me = await axios.get(
    `${JIRA}/rest/api/3/myself`,
    { auth: { username: process.env.JIRA_EMAIL, password: process.env.JIRA_TOKEN } }
  );
  console.log("Hello from Jira 👋, I am", me.data.displayName);
})();
