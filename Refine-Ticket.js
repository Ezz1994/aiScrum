/*
  refine-backlog.js — “Backlog‑Doctor” micro‑service
  --------------------------------------------------
  Scans Jira Cloud for issues that match JQL_CRITERIA,
  rewrites each issue’s user‑story body via OpenAI GPT,
  then either posts the rewrite as a *comment* or
  overwrites the description (update‑in‑place).

  ▸ Node 20+
  ▸ npm install axios dotenv
  ▸ .env must contain: OPENAI_KEY, JIRA_EMAIL, JIRA_TOKEN, JIRA_DOMAIN

  Deploy options:
    • Local cron  →  node refine-backlog.js
    • GitHub Action →  uses `runs-on: ubuntu-latest`
    • AWS Lambda   →  handler = refine

  -------------------------------------------------- */

require("dotenv").config(); // requires Node ≥20 with "type":"module" in package.json
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");

//--------------------------------------------------
// 1 ▸ CONFIGURATION (edit to your needs)
//--------------------------------------------------
const JQL_CRITERIA = 'project = SCRUM AND status = "REFINING"';
const MAX_ISSUES = 10; // safety: process N per run
const MODE = "UPDATE"; // COMMENT | UPDATE
const MODEL = "gpt-4o-mini"; // cheap; switch to gpt-4o-mini for better quality
const MIN_OUTPUT_CHARS = 60; // guard‑rail: skip empty or junk answers

//--------------------------------------------------
// 2 ▸ LOG FILE  🔸 CHANGED (helper now defined immediately after)
//--------------------------------------------------

(async () => {
  // make sure /logs exists
  await fs.mkdir("logs", { recursive: true });
})();
const LOG_FILE = path.resolve("logs", `run-${Date.now()}.jsonl`);

(async () => {
  // write the “Log started” line
  await fs.appendFile(
    LOG_FILE,
    JSON.stringify({ msg: "Log started", ts: new Date().toISOString() }) + "\n"
  );
  console.log("Log file will be:", LOG_FILE);
})();

async function log(obj) {
  // call this anywhere
  await fs.appendFile(LOG_FILE, JSON.stringify(obj) + "\n");
}
//--------------------------------------------------
// 3 ▸ HELPERS: Jira + OpenAI wrappers
//--------------------------------------------------
const JIRA_BASE = `https://${process.env.JIRA_DOMAIN}`;
const jira = axios.create({
  baseURL: JIRA_BASE,
  auth: {
    username: process.env.JIRA_EMAIL,
    password: process.env.JIRA_TOKEN,
  },
});

async function fetchIssues() {
  const { data } = await jira.get("/rest/api/3/search", {
    params: {
      jql: JQL_CRITERIA,
      fields: "summary,description",
      maxResults: MAX_ISSUES,
    },
  });
  return data.issues;
}

function buildPrompt(summary, description) {
  return (
    `You are “StoryDoctor”, an expert Agile Product Manager and QA analyst.

### Rewrite this Jira ticket into a PROFESSIONAL USER STORY that is ready for development and QA.

**Rules:**
1. Preserve **every factual detail** from the original description—do **NOT** invent scope.
2. Write the summary as an imperative verb phrase that starts with a capital letter (e.g., “Generate PDF invoices from order page”).
3. Structure the description in this exact order:

   **User Story**
   As a <user role>, I want <need>, so that <business value>.

   **Context / Details**
   • … (bullet each important detail, business rule, edge‑case, link, or constraint).
   • …

   **Acceptance Criteria (Gherkin)**
   AC 1: **Given** … **When** … **Then** …
   AC 2: **Given** … **When** … **Then** …
   _(Add as many ACs as needed to fully cover the story. Each must be testable.)_

   **Out of Scope**
   • List anything explicitly *not* covered.

   **Notes**
   • Leave blank if none.

4. Each Acceptance Criterion **must** be independent, atomic, and written in Gherkin *Given/When/Then* form so QA can automate tests directly.
5. Keep estimates, component tags, and external links unchanged.
6. Output in Atlassian wiki‑markup (plain text) only—no markdown, no HTML.

### Original Ticket
SUMMARY:
${summary}

DESCRIPTION:
${description || 'None'}
  `
  );
}

const openai = axios.create({
  baseURL: "https://api.openai.com/v1",
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_KEY}`,
  },
});

async function rewriteStory(prompt) {
  const { data } = await openai.post("/chat/completions", {
    model: MODEL,
    messages: [
      { role: "system", content: "You are StoryDoctor, a senior agile PM." },
      { role: "user", content: prompt },
    ],
  });
  return data.choices[0].message.content.trim();
}


// ------- ADF helper for COMMENT mode -------
function toADF(text) {
    return {
      type: 'doc',
      version: 1,
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text }],
      }],
    };
  }
  

async function commentOnIssue(key, body) {
  await jira.post(`/rest/api/3/issue/${key}/comment`, {body:
    toADF(body),
  });
}

async function updateIssueDescription(key, body) {
  await jira.put(`/rest/api/3/issue/${key}`, {
    fields: { description: toADF(body) },
  });
}

//--------------------------------------------------
// 4 ▸ MAIN EXECUTION
//--------------------------------------------------
async function main() {
  const issues = await fetchIssues();
  await log({
    ts: new Date().toISOString(),
    msg: "Run started",
    jql: JQL_CRITERIA,
  });
  console.log(`Found ${issues.length} issue(s) matching JQL`);
  await log({
    ts: new Date().toISOString(),
    msg: "Issues fetched",
    count: issues.length,
  });

  let ok = 0,
    skipped = 0,
    errors = 0;

  for (const issue of issues) {
    const prompt = buildPrompt(issue.fields.summary, issue.fields.description);
    let completion = "";
    let status = "OK";

    try {
      completion = await rewriteStory(prompt);

      if (completion.length < MIN_OUTPUT_CHARS) {
        status = "SKIPPED_OUTPUT_TOO_SHORT";
        skipped++;
      } else if (MODE === "COMMENT") {
        await commentOnIssue(issue.key, completion);
        ok++;
      } else {
        await updateIssueDescription(issue.key, completion);
        ok++;
      }
    } catch (err) {
      status = `ERROR: ${err.message}`;
      errors++;
      console.error(`❌ ${issue.key} failed → ${err.message}`);
      errors++;
      const details = err.response?.data || {};
      status = `ERROR_${err.response?.status || "UNKNOWN"}`; // e.g., ERROR_400

      console.error(`❌ ${issue.key} failed →`, err.message);
      console.error("   Jira said:", JSON.stringify(details));
      await log({
        // extra line with the full error payload
        ts: new Date().toISOString(),
        issue: issue.key,
        status,
        errorMessage: err.message,
        jiraDetails: details,
      });
    }

    await log({
      ts: new Date().toISOString(),
      issue: issue.key,
      status,
      promptChars: prompt.length,
      completionChars: completion.length,
    });

    if (status === "OK") console.log(`✅ ${issue.key} processed`);
  }
  await log({
    ts: new Date().toISOString(),
    msg: "Run summary",
    processed: ok,
    skipped,
    errors,
  });
}

//--------------------------------------------------
// 5 ▸ ENTRYPOINT (allow import without run)
//--------------------------------------------------
if (require.main === module) {
  main()
    .then(() => console.log("🎉  Run complete"))
    .catch((err) => {
      console.error("🔥  Run failed", err);
      log({
        ts: new Date().toISOString(),
        msg: "Run failed",
        error: err.message,
      });
    });
}

//--------------------------------------------------
// 6 ▸ EXPORTS (for unit tests)
//--------------------------------------------------
module.exports = { buildPrompt, rewriteStory, fetchIssues };
