#!/usr/bin/env node
// Live smoke test for the Nightforge Linear console.
// Runs "project list" / "project help" / "project discover" as comments on
// the Home ticket, plus the old ticket-in-Ready flow, and verifies every
// reply against the real on-disk project registry.
// Usage: LINEAR_API_KEY=... CONTROL_TEAM_ID=... node ops/live-console-smoke.mjs
//        (or --api-key / --team-id flags). PROJECTS_DIR defaults to
//        /opt/nightforge/projects. Never prints secrets.
// Exit code 0 = all checks passed, 1 = any failed.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) {
    args.set(process.argv[i].slice(2), process.argv[i + 1] ?? "");
  }
}
const byName = (camel, kebab) => args.get(camel) || args.get(kebab);

const API_KEY = process.env.LINEAR_API_KEY || byName("apiKey", "api-key");
const TEAM_ID = process.env.CONTROL_TEAM_ID || byName("teamId", "team-id");
const PROJECTS_DIR = process.env.PROJECTS_DIR || "/opt/nightforge/projects";
const RESERVED = new Set(["releases"]);

if (!API_KEY || !TEAM_ID) {
  console.error("Missing LINEAR_API_KEY or CONTROL_TEAM_ID");
  process.exit(2);
}

let failed = 0;

async function gql(query, variables = {}) {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: API_KEY },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json();
  if (!response.ok || result.errors?.length) {
    throw new Error(result.errors?.[0]?.message || `HTTP ${response.status}`);
  }
  return result.data;
}

async function findHomeIssue() {
  const data = await gql(
    `query TeamIssues($teamId: String!) {
      team(id: $teamId) { issues(first: 100) { nodes { id title } } }
    }`,
    { teamId: TEAM_ID }
  );
  const issues = data.team?.issues?.nodes ?? [];
  return issues.find((issue) => issue.title?.includes("Nightforge Home")) ?? null;
}

// Posts the command comment, then polls the thread every 5s for a NEW bot
// reply (body starts with "⚙️", createdAt > afterAt; afterAt null = any).
async function waitForReply(issueId, body, afterAt, timeoutMs = 60000) {
  await gql(
    `mutation CreateComment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }`,
    { issueId, body }
  );
  const deadline = Date.now() + timeoutMs;
  const query = `query Comments($issueId: String!) {
    issue(id: $issueId) { comments { nodes { body createdAt } } }
  }`;
  while (Date.now() < deadline) {
    const data = await gql(query, { issueId });
    const comments = data.issue?.comments?.nodes ?? [];
    const reply = comments.find(
      (c) =>
        c.body?.startsWith("⚙️") &&
        (afterAt === null || String(c.createdAt) > afterAt)
    );
    if (reply) return reply.body;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return null;
}

// On-disk registry, mirroring the server implementation: directories carrying
// a .nightforge/project.yaml marker, excluding reserved dirs.
function onDiskRegistry() {
  let entries;
  try {
    entries = readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !RESERVED.has(entry.name) &&
        existsSync(path.join(PROJECTS_DIR, entry.name, ".nightforge", "project.yaml"))
    )
    .map((entry) => entry.name)
    .sort();
}

// Verifies a "project list" reply against the real on-disk registry.
function checkListReply(reply) {
  const registry = onDiskRegistry();
  const problems = [];
  if (registry.length === 0) {
    if (!reply.includes("No projects registered")) {
      problems.push("expected 'No projects registered'");
    }
  } else {
    if (!reply.includes("Registered projects")) {
      problems.push("missing 'Registered projects'");
    }
    for (const id of registry) {
      if (!reply.includes(`- **${id}**`)) problems.push(`missing project ${id}`);
    }
  }
  let allDirs = [];
  try {
    allDirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !RESERVED.has(e.name))
      .map((e) => e.name);
  } catch {
    // No read access to the root — skip the "no extra dirs" scan.
  }
  for (const dir of allDirs) {
    if (!registry.includes(dir) && reply.includes(`- **${dir}**`)) {
      problems.push(`listed unregistered dir ${dir}`);
    }
  }
  return problems;
}

async function runChecks() {
  let home;
  try {
    home = await findHomeIssue();
  } catch (err) {
    failed++;
    console.error(`FAIL: CHK0 findHomeIssue — ${err.message}`);
    return;
  }
  if (!home) {
    failed++;
    console.error("FAIL: CHK0 findHomeIssue — no 'Nightforge Home' issue in control team");
    return;
  }
  console.log(`Home issue: ${home.title} (${home.id})`);
  const homeId = home.id;
  const lastCommentAt = async () => {
    const data = await gql(
      `query Issue($id: String!) { issue(id: $id) { comments { nodes { createdAt } } } }`,
      { id: homeId }
    );
    // Comments can come back newest-first; take the latest createdAt of all.
    const stamps = (data.issue?.comments?.nodes ?? []).map((c) => String(c.createdAt));
    return stamps.length > 0 ? stamps.sort().at(-1) : null;
  };

  // CHK1: project list on the Home ticket, matched against the on-disk registry.
  try {
    const before = await lastCommentAt();
    const reply = await waitForReply(homeId, "project list", before);
    console.log(`\n== CHK1 'project list' reply ==\n${reply ?? "(no reply)"}\n`);
    if (reply === null) {
      failed++;
      console.log("FAIL: CHK1 'project list' on home — no new bot reply within 60s");
    } else {
      const problems = checkListReply(reply);
      if (problems.length) {
        failed++;
        console.log(`FAIL: CHK1 'project list' on home — ${problems.join("; ")}`);
      } else {
        console.log("PASS: CHK1 'project list' on home matches the on-disk registry");
      }
    }
  } catch (err) {
    failed++;
    console.log(`FAIL: CHK1 'project list' on home — ${err.message}`);
  }

  // CHK2: help.
  try {
    const before2 = await lastCommentAt();
    const reply = await waitForReply(homeId, "help", before2);
    console.log(`\n== CHK2 'help' reply ==\n${reply ?? "(no reply)"}\n`);
    if (reply === null) {
      failed++;
      console.log("FAIL: CHK2 'help' — no new bot reply within 60s");
    } else if (!reply.includes("project add") || !reply.includes("project list")) {
      failed++;
      console.log("FAIL: CHK2 'help' — reply missing 'project add'/'project list'");
    } else {
      console.log("PASS: CHK2 'help' lists the console commands");
    }
  } catch (err) {
    failed++;
    console.log(`FAIL: CHK2 'help' — ${err.message}`);
  }

  // CHK3: discover — live server has GITHUB_TOKEN, so expect a real listing.
  try {
    const before3 = await lastCommentAt();
    const reply = await waitForReply(homeId, "project discover", before3);
    console.log(`\n== CHK3 'project discover' reply ==\n${reply ?? "(no reply)"}\n`);
    if (reply === null) {
      failed++;
      console.log("FAIL: CHK3 'project discover' — no new bot reply within 60s");
    } else if (!reply.includes("GitHub repos on this account")) {
      failed++;
      console.log("FAIL: CHK3 'project discover' — reply is not a GitHub repo listing");
    } else {
      console.log("PASS: CHK3 'project discover' lists GitHub repos");
    }
  } catch (err) {
    failed++;
    console.log(`FAIL: CHK3 'project discover' — ${err.message}`);
  }

  // CHK4: old way — a command ticket dropped into the Ready state.
  let chk4Id = null;
  try {
    const states = await gql(
      `query States($teamId: String!) { team(id: $teamId) { states { nodes { id name } } } }`,
      { teamId: TEAM_ID }
    );
    const ready = (states.team?.states?.nodes ?? []).find(
      (s) => /ready for ai|ready/i.test(s.name)
    );
    if (!ready) throw new Error("no Ready state in control team");
    const created = await gql(
      `mutation Create($teamId: String!, $title: String!, $stateId: String!) {
        issueCreate(input: { teamId: $teamId, title: $title, stateId: $stateId }) {
          issue { id }
        }
      }`,
      { teamId: TEAM_ID, title: "project list", stateId: ready.id }
    );
    chk4Id = created.issueCreate?.issue?.id;
    if (!chk4Id) throw new Error("issueCreate returned no id");
    const reply = await waitForReply(chk4Id, " ", null);
    console.log(`\n== CHK4 'project list' via Ready ticket reply ==\n${reply ?? "(no reply)"}\n`);
    if (reply === null) {
      failed++;
      console.log("FAIL: CHK4 'project list' via Ready ticket — no bot reply within 60s");
    } else {
      const problems = checkListReply(reply);
      if (problems.length) {
        failed++;
        console.log(`FAIL: CHK4 'project list' via Ready ticket — ${problems.join("; ")}`);
      } else {
        console.log("PASS: CHK4 'project list' via Ready ticket matches the on-disk registry");
      }
    }
  } catch (err) {
    failed++;
    console.log(`FAIL: CHK4 'project list' via Ready ticket — ${err.message}`);
  } finally {
    if (chk4Id) {
      try {
        await gql(
          `mutation Delete($id: String!) { issueDelete(id: $id) { success } }`,
          { id: chk4Id }
        );
        console.log("CHK4 cleanup: test issue deleted");
      } catch (err) {
        console.log(`CHK4 cleanup warning: could not delete test issue — ${err.message}`);
      }
    }
  }

  console.log(`\nSmoke result: ${failed === 0 ? "ALL PASS" : `${failed} FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}

runChecks().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});