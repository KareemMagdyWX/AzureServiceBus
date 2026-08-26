#!/usr/bin/env node
'use strict';

/**
 * Creates a Taiga task from a GitHub PR when someone comments `/taiga`.
 *
 *   /taiga
 *   /taiga assigned_to=@octocat
 *   /taiga assigned_to=@octocat status="Ready for test"
 *   /taiga us=412
 *
 * Defaults: assignee = whoever commented, status = "New",
 * project + user story = .github/taiga.yml, watchers = PR reviewers.
 */

const fs = require('fs');
const yaml = require('js-yaml');

const {
  TAIGA_URL,
  TAIGA_USERNAME,
  TAIGA_PASSWORD,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  COMMENT_ID,
  COMMENT_BODY,
  COMMENT_AUTHOR,
  CONFIG_PATH = '.github/taiga.yml',
} = process.env;

const [OWNER, REPO] = String(GITHUB_REPOSITORY || '').split('/');

/** Errors a human can fix by editing their comment or the config. */
class UserError extends Error {}

// ---------------------------------------------------------------- GitHub API

async function gh(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// Feedback on the triggering comment. Never let these throw — they are
// cosmetic, and a failure here must not mask the real error.
const react = (content) =>
  gh(`/repos/${OWNER}/${REPO}/issues/comments/${COMMENT_ID}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  }).catch((e) => console.warn(`could not react: ${e.message}`));

const reply = (body) =>
  gh(`/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  }).catch((e) => console.warn(`could not comment: ${e.message}`));

// ----------------------------------------------------------------- Taiga API

let token = null;

async function taiga(path, options = {}) {
  const res = await fetch(`${TAIGA_URL}/api/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Taiga ${path} -> ${res.status} ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function login() {
  // Short-lived job, so a fresh login beats managing token refresh.
  const data = await taiga('/auth', {
    method: 'POST',
    body: JSON.stringify({
      type: 'normal',
      username: TAIGA_USERNAME,
      password: TAIGA_PASSWORD,
    }),
  });
  if (!data || !data.auth_token) throw new Error('Taiga auth returned no token');
  token = data.auth_token;
}

// ------------------------------------------------------------------- Parsing

/** Pull `key=value` / `key="two words"` pairs off the /taiga line. */
function parseDirectives(body) {
  const line = String(body || '')
    .split('\n')
    .find((l) => l.trim().startsWith('/taiga'));
  if (!line) return {};

  const rest = line.trim().slice('/taiga'.length);
  const pairs = /([a-z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/gi;
  const out = {};
  let m;
  while ((m = pairs.exec(rest)) !== null) {
    out[m[1].toLowerCase()] = String(m[2] ?? m[3] ?? m[4] ?? '').trim();
  }
  return out;
}

/** Config keys are GitHub logins, which are case-insensitive. */
function taigaIdFor(login, users) {
  if (!login) return null;
  const key = Object.keys(users).find((k) => k.toLowerCase() === login.toLowerCase());
  return key ? users[key] : null;
}

function resolveStatus(statuses, wanted, projectDefaultId) {
  const names = statuses.map((s) => `\`${s.name}\``).join(', ');

  if (wanted) {
    const hit = statuses.find((s) => s.name.toLowerCase() === wanted.toLowerCase());
    if (!hit) throw new UserError(`Unknown status \`${wanted}\`. This project has: ${names}`);
    return hit;
  }
  // Default to "New", falling back to whatever the project considers default.
  const fresh = statuses.find((s) => s.name.toLowerCase() === 'new');
  if (fresh) return fresh;

  const fallback = statuses.find((s) => s.id === projectDefaultId);
  if (fallback) return fallback;

  throw new UserError(`No \`New\` status and no project default. Available: ${names}`);
}

/**
 * Reviewers, then the config senior. `requested_reviewers` only holds people
 * who have not reviewed yet, so submitted reviews are merged in too.
 */
async function resolveWatchers(cfg, members) {
  const logins = new Set();

  const pr = await gh(`/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}`);
  for (const r of pr.requested_reviewers || []) logins.add(r.login);

  const reviews = await gh(`/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/reviews?per_page=100`);
  for (const r of reviews || []) if (r.user) logins.add(r.user.login);

  if (logins.size === 0 && cfg.senior) logins.add(cfg.senior);

  const ids = [];
  const unmapped = [];
  for (const login of logins) {
    const id = taigaIdFor(login, cfg.users || {});
    if (id && members.has(id)) ids.push(id);
    else unmapped.push(login);
  }
  return { pr, ids: [...new Set(ids)], unmapped };
}

// ---------------------------------------------------------------------- Main

async function run() {
  for (const [k, v] of Object.entries({ TAIGA_URL, TAIGA_USERNAME, TAIGA_PASSWORD, GITHUB_TOKEN })) {
    if (!v) throw new Error(`Missing required env var ${k}`);
  }

  if (!fs.existsSync(CONFIG_PATH)) {
    throw new UserError(`No config at \`${CONFIG_PATH}\`. See the setup notes to create one.`);
  }
  const cfg = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
  if (!cfg.project) throw new UserError(`\`project\` is missing from \`${CONFIG_PATH}\`.`);

  const directives = parseDirectives(COMMENT_BODY);
  const projectId = Number(cfg.project);
  const usId = Number(directives.us || cfg.user_story || 0);
  if (!usId) {
    throw new UserError('No user story. Set `user_story` in the config or pass `us=<id>`.');
  }

  await login();

  // Everything needed to validate before writing anything.
  const [project, statuses, memberList, story] = await Promise.all([
    taiga(`/projects/${projectId}`),
    taiga(`/task-statuses?project=${projectId}`),
    taiga(`/users?project=${projectId}`),
    taiga(`/userstories/${usId}`).catch(() => null),
  ]);

  if (!story) throw new UserError(`User story \`#${usId}\` not found.`);
  if (story.project !== projectId) {
    throw new UserError(`User story \`#${usId}\` belongs to another project.`);
  }

  const members = new Set(memberList.map((u) => u.id));

  // Assignee: explicit wins, otherwise whoever ran the command.
  const rawAssignee = String(directives.assigned_to || COMMENT_AUTHOR).replace(/^@/, '');
  const assigneeId = taigaIdFor(rawAssignee, cfg.users || {});
  if (!assigneeId) {
    throw new UserError(
      `\`${rawAssignee}\` is not in the \`users\` map in \`${CONFIG_PATH}\`. ` +
        'Add their Taiga id and try again.'
    );
  }
  if (!members.has(assigneeId)) {
    throw new UserError(
      `\`${rawAssignee}\` maps to Taiga id ${assigneeId}, who is not a member of this project.`
    );
  }

  const status = resolveStatus(statuses, directives.status, project.default_task_status);
  const { pr, ids: watchers, unmapped } = await resolveWatchers(cfg, members);

  // One task per PR, keyed on the PR url, so re-running is safe.
  const existing = await taiga(`/tasks?user_story=${usId}`);
  const duplicate = (existing || []).find(
    (t) => Array.isArray(t.external_reference) && t.external_reference[1] === pr.html_url
  );
  if (duplicate) {
    await react('+1');
    await reply(
      `Already tracked as Taiga task **#${duplicate.ref}** — ${taskUrl(project, duplicate)}`
    );
    return;
  }

  const commits = await gh(`/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/commits?per_page=100`);
  const checklist = (commits || [])
    .filter((c) => (c.parents || []).length <= 1) // drop merge commits
    .map((c) => `- [ ] \`${c.sha.slice(0, 7)}\` ${c.commit.message.split('\n')[0]}`)
    .join('\n');

  const created = await taiga('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      project: projectId,
      user_story: usId,
      subject: `${pr.title} (#${PR_NUMBER})`,
      assigned_to: assigneeId,
      status: status.id,
      watchers,
      description: [
        `Pull request: ${pr.html_url}`,
        `Branch: \`${pr.head.ref}\``,
        '',
        '**Commits**',
        checklist || '_none_',
      ].join('\n'),
      external_reference: ['github', pr.html_url],
    }),
  });

  // `watchers` on create is inconsistent across Taiga versions — verify.
  let watcherNote = '';
  if (watchers.length) {
    const check = await taiga(`/tasks/${created.id}`).catch(() => null);
    if (check && (check.watchers || []).length === 0) {
      watcherNote = '\n\n> Watchers were not applied — see the setup notes on the `/watch` fallback.';
    }
  }
  if (unmapped.length) {
    watcherNote += `\n\n> Not added as watchers (no Taiga mapping): ${unmapped
      .map((l) => `\`${l}\``)
      .join(', ')}`;
  }

  await react('rocket');
  await reply(
    [
      `Created Taiga task **#${created.ref}** — ${taskUrl(project, created)}`,
      '',
      `- **Assigned to** \`${rawAssignee}\``,
      `- **Status** ${status.name}`,
      `- **Under** US #${story.ref} — ${story.subject}`,
      `- **Watching** ${watchers.length || 'nobody'}`,
    ].join('\n') + watcherNote
  );
}

function taskUrl(project, task) {
  return `https://tree.taiga.io/project/${project.slug}/task/${task.ref}`;
}

run().catch(async (err) => {
  console.error(err);
  await react('confused');
  await reply(
    err instanceof UserError
      ? `**Taiga sync failed.** ${err.message}`
      : `**Taiga sync failed** with an unexpected error. See the [workflow run](https://github.com/${OWNER}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}) for details.\n\n\`\`\`\n${String(err.message).slice(0, 500)}\n\`\`\``
  );
  process.exit(1);
});
