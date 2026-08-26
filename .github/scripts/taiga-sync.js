#!/usr/bin/env node
'use strict';

/**
 * Creates a Taiga task for a pull request.
 *
 * Runs automatically when a PR opens. Optional overrides go on their own
 * line, either in the PR description or in a follow-up PR comment:
 *
 *   /taiga assigned_to=@octocat
 *   /taiga status="Ready for test"
 *   /taiga us=412
 *
 * Defaults: assignee = PR author (or commenter), status = "New",
 * project + user story = .github/taiga.yml, watchers = PR reviewers.
 *
 * Re-running is always safe — tasks are keyed on the PR url.
 */

const fs = require('fs');

const {
  TAIGA_URL = 'https://api.taiga.io',
  TAIGA_USERNAME,
  TAIGA_PASSWORD,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  COMMENT_ID,
  TRIGGER_BODY,
  TRIGGER_AUTHOR,
  CONFIG_PATH = '.github/taiga.yml',
  TAIGA_PROJECT,
  TAIGA_USER_STORY,
  TAIGA_WATCHER,
  TAIGA_USERS,
} = process.env;

const [OWNER, REPO] = String(GITHUB_REPOSITORY || '').split('/');

/** Errors a human can fix by editing their comment or the config. */
class UserError extends Error {}

// ---------------------------------------------------------------- GitHub API

// No timeout means a stalled connection hangs the job until GitHub's
// 6-hour ceiling. Every request gets a hard ceiling instead.
const REQUEST_TIMEOUT_MS = 20000;

function step(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function gh(path, options = {}) {
  let res;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error(`GitHub ${path} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(`GitHub ${path} failed: ${e.message}`);
  }
  if (!res.ok) {
    throw new Error(`GitHub ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// Feedback on the trigger. Never let these throw — they are cosmetic, and a
// failure here must not mask the real error. With no triggering comment
// (a pull_request event) the reaction goes on the PR itself.
const react = (content) =>
  gh(
    COMMENT_ID
      ? `/repos/${OWNER}/${REPO}/issues/comments/${COMMENT_ID}/reactions`
      : `/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/reactions`,
    { method: 'POST', body: JSON.stringify({ content }) }
  ).catch((e) => console.warn(`could not react: ${e.message}`));

const reply = (body) =>
  gh(`/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  }).catch((e) => console.warn(`could not comment: ${e.message}`));

// ----------------------------------------------------------------- Taiga API

let token = null;

async function taiga(path, options = {}) {
  let res;
  try {
    res = await fetch(`${TAIGA_URL}/api/v1${path}`, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error(
        `Taiga ${path} timed out after ${REQUEST_TIMEOUT_MS / 1000}s. ` +
          `Check TAIGA_URL (currently ${TAIGA_URL}) and that Taiga is reachable.`
      );
    }
    throw new Error(`Taiga ${path} failed: ${e.message}`);
  }
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

/**
 * The number in a Taiga URL (/us/528) is the per-project `ref`, not the
 * internal id that /userstories/{id} expects. People copy the URL, so try
 * ref first and fall back to a raw id lookup.
 */
async function resolveUserStory(num, projectId) {
  const byRef = await taiga(
    `/userstories/by_ref?ref=${num}&project=${projectId}`
  ).catch(() => null);
  if (byRef && byRef.id) return byRef;

  const byId = await taiga(`/userstories/${num}`).catch(() => null);
  if (byId && byId.id && byId.project === projectId) return byId;

  if (byId && byId.id) {
    throw new UserError(
      `User story id \`${num}\` exists but belongs to project ${byId.project}, ` +
        `not ${projectId}. Check \`project\` in the config.`
    );
  }
  throw new UserError(
    `No user story \`#${num}\` in project ${projectId}. Use the number from ` +
      `the Taiga URL — for \`/us/528\` that is \`528\`. If that is what you ` +
      `used, confirm \`project\` in the config matches the project the story ` +
      `lives in.`
  );
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
 * Reviewers, then the config `watcher`. `requested_reviewers` only holds
 * people who have not reviewed yet, so submitted reviews are merged in too.
 */
async function resolveWatchers(cfg, members) {
  const logins = new Set();

  const pr = await gh(`/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}`);
  for (const r of pr.requested_reviewers || []) logins.add(r.login);

  const reviews = await gh(`/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/reviews?per_page=100`);
  for (const r of reviews || []) if (r.user) logins.add(r.user.login);

  // `senior` was the old name for this key; still honoured so an existing
  // config does not quietly stop adding a fallback watcher.
  if (cfg.watcher === undefined && cfg.senior !== undefined) {
    console.warn('config: `senior` is deprecated, rename it to `watcher`');
  }
  const fallback = cfg.watcher ?? cfg.senior;

  // Accepts a single login or a list.
  if (logins.size === 0 && fallback) {
    for (const l of [].concat(fallback)) logins.add(l);
  }

  const ids = [];
  const unmapped = [];
  const notMember = [];
  for (const login of logins) {
    const id = taigaIdFor(login, cfg.users || {});
    if (!id) unmapped.push(login);
    else if (!members.has(id)) notMember.push(`${login} (taiga id ${id})`);
    else ids.push(id);
  }

  // Watchers going missing is the most common surprise here, so show the
  // whole resolution chain rather than just the result.
  step(
    `watchers: candidates [${[...logins].join(', ') || 'none'}] -> ` +
      `resolved [${ids.join(', ') || 'none'}]` +
      (unmapped.length ? `, unmapped [${unmapped.join(', ')}]` : '') +
      (notMember.length ? `, not project members [${notMember.join(', ')}]` : '')
  );

  return { pr, ids: [...new Set(ids)], unmapped, notMember };
}

// ---------------------------------------------------------------------- Main

/**
 * Config comes from action inputs when running as a shared action, or from
 * .github/taiga.yml for a single-repo install. Inputs win when both exist.
 * `source` is carried through so error messages point at the right place.
 */
function loadConfig() {
  if (TAIGA_PROJECT) {
    let users = {};
    if (TAIGA_USERS && TAIGA_USERS.trim()) {
      try {
        users = JSON.parse(TAIGA_USERS);
      } catch (e) {
        throw new UserError(
          'The `users` input is not valid JSON. Expected something like ' +
            '`{"octocat": 42, "alice-dev": 57}`. ' +
            'If it comes from an org variable, check for a trailing comma or single quotes.'
        );
      }
      if (Array.isArray(users) || typeof users !== 'object' || users === null) {
        throw new UserError('The `users` input must be a JSON object of login -> taiga id.');
      }
    }
    return {
      source: 'the action inputs',
      project: Number(TAIGA_PROJECT),
      user_story: Number(TAIGA_USER_STORY || 0),
      watcher: TAIGA_WATCHER
        ? TAIGA_WATCHER.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined,
      users,
    };
  }

  if (!fs.existsSync(CONFIG_PATH)) {
    throw new UserError(
      `No config found. Either pass the \`project\` input, or create \`${CONFIG_PATH}\`.`
    );
  }
  // Required only for the file path, so a pure-inputs run needs no dependency.
  let yaml;
  try {
    yaml = require('js-yaml');
  } catch {
    throw new UserError(
      `Reading \`${CONFIG_PATH}\` needs js-yaml, which is not installed. ` +
        'Either add `npm install --no-save js-yaml@4` before this step, or ' +
        'pass the `project` / `user-story` / `users` inputs instead.'
    );
  }
  const cfg = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
  cfg.source = `\`${CONFIG_PATH}\``;
  return cfg;
}

const CREDENTIAL_HELP = {
  TAIGA_USERNAME: 'Taiga service account login',
  TAIGA_PASSWORD: 'Taiga service account password',
  GITHUB_TOKEN: 'usually `${{ secrets.GITHUB_TOKEN }}`, which GitHub provides automatically',
};

async function run() {
  // GitHub does not enforce `required: true` on composite action inputs at
  // runtime, so an unset secret arrives as an empty string rather than
  // failing the step. Catch that here with a message that says where to fix it.
  const missing = ['TAIGA_USERNAME', 'TAIGA_PASSWORD', 'GITHUB_TOKEN'].filter(
    (k) => !process.env[k]
  );
  if (missing.length) {
    throw new UserError(
      `Missing credential(s): ${missing.map((k) => `\`${k}\``).join(', ')}.\n\n` +
        missing.map((k) => `- \`${k}\` — ${CREDENTIAL_HELP[k]}`).join('\n') +
        '\n\nSecrets resolve environment > repository > organization, so either ' +
        'scope works. If you set them as **organization** secrets, check the ' +
        "secret's repository access includes this repo — an org secret scoped to " +
        'other repositories resolves to an empty string here, with no warning.'
    );
  }

  const cfg = loadConfig();
  if (!cfg.project) throw new UserError(`\`project\` is missing from ${cfg.source}.`);

  const directives = parseDirectives(TRIGGER_BODY);
  const projectId = Number(cfg.project);
  const usRef = Number(directives.us || cfg.user_story || 0);
  if (!usRef) {
    throw new UserError('No user story. Set `user_story` in the config or pass `us=<ref>`.');
  }

  step('authenticating to Taiga');
  await login();

  // Everything needed to validate before writing anything.
  step(`fetching project ${projectId} metadata and user story ref ${usRef}`);
  const [project, statuses, memberList, story] = await Promise.all([
    taiga(`/projects/${projectId}`),
    taiga(`/task-statuses?project=${projectId}`),
    taiga(`/users?project=${projectId}`),
    resolveUserStory(usRef, projectId),
  ]);

  const members = new Set(memberList.map((u) => u.id));

  // Assignee: explicit wins, otherwise whoever ran the command.
  const rawAssignee = String(directives.assigned_to || TRIGGER_AUTHOR).replace(/^@/, '');
  const assigneeId = taigaIdFor(rawAssignee, cfg.users || {});
  if (!assigneeId) {
    throw new UserError(
      `\`${rawAssignee}\` is not in the \`users\` map in ${cfg.source}. ` +
        'Add their Taiga id and try again.'
    );
  }
  if (!members.has(assigneeId)) {
    throw new UserError(
      `\`${rawAssignee}\` maps to Taiga id ${assigneeId}, who is not a member of this project.`
    );
  }

  const status = resolveStatus(statuses, directives.status, project.default_task_status);
  step('resolving reviewers');
  const { pr, ids: watchers, unmapped, notMember } = await resolveWatchers(cfg, members);

  // One task per PR, keyed on the PR url, so re-running is safe.
  step(`checking for an existing task under US ${story.id}`);
  const existing = await taiga(`/tasks?user_story=${story.id}`);
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

  step('fetching commits');
  const commits = await gh(`/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/commits?per_page=100`);
  const checklist = (commits || [])
    .filter((c) => (c.parents || []).length <= 1) // drop merge commits
    .map((c) => `- [ ] \`${c.sha.slice(0, 7)}\` ${c.commit.message.split('\n')[0]}`)
    .join('\n');

  // Named in the description as a fallback: if Taiga refuses the watchers
  // field, at least the task says who should be looking at it.
  const nameById = new Map(memberList.map((u) => [u.id, u.username || u.full_name || u.id]));
  const watcherLine = watchers.length
    ? `Watching: ${watchers.map((id) => `@${nameById.get(id)}`).join(', ')}`
    : null;

  step('creating task');
  const created = await taiga('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      project: projectId,
      user_story: story.id,
      subject: `${pr.title} (#${PR_NUMBER})`,
      assigned_to: assigneeId,
      status: status.id,
      watchers,
      description: [
        `Pull request: ${pr.html_url}`,
        `Branch: \`${pr.head.ref}\``,
        ...(watcherLine ? [watcherLine] : []),
        '',
        '**Commits**',
        checklist || '_none_',
      ].join('\n'),
      external_reference: ['github', pr.html_url],
    }),
  });

  // Taiga ignores `watchers` on create in some versions. Verify, and if it
  // was dropped, retry with a PATCH — `version` is required because Taiga
  // uses optimistic concurrency and rejects updates without it.
  let applied = watchers.length;
  const notes = [];

  if (watchers.length) {
    let check = await taiga(`/tasks/${created.id}`).catch(() => null);

    if (check && (check.watchers || []).length === 0) {
      step('watchers dropped on create, retrying via PATCH');
      const patched = await taiga(`/tasks/${created.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ watchers, version: check.version }),
      }).catch((e) => {
        step(`PATCH failed: ${e.message}`);
        return null;
      });

      check = patched || (await taiga(`/tasks/${created.id}`).catch(() => null));
      applied = check ? (check.watchers || []).length : 0;

      if (applied === 0) {
        notes.push(
          '> Taiga would not accept watchers on this task, on create or via update. ' +
            'The people below are named in the description instead so they still get a mention.'
        );
      } else {
        step(`PATCH applied ${applied} watcher(s)`);
      }
    } else if (check) {
      applied = (check.watchers || []).length;
    }
  }

  if (unmapped.length) {
    notes.push(
      `> Not watching (missing from \`users\` in ${cfg.source}): ` +
        unmapped.map((l) => `\`${l}\``).join(', ')
    );
  }
  if (notMember.length) {
    notes.push(
      '> Not watching (not a member of this Taiga project): ' +
        notMember.map((l) => `\`${l}\``).join(', ')
    );
  }

  await react('rocket');
  await reply(
    [
      `Created Taiga task **#${created.ref}** — ${taskUrl(project, created)}`,
      '',
      `- **Assigned to** \`${rawAssignee}\``,
      `- **Status** ${status.name}`,
      `- **Under** US #${story.ref} — ${story.subject}`,
      `- **Watching** ${applied || 'nobody'}`,
    ].join('\n') + (notes.length ? '\n\n' + notes.join('\n\n') : '')
  );
}

function taskUrl(project, task) {
  return `https://tree.taiga.io/project/${project.slug}/task/${task.ref}`;
}

run()
  .then(() => step('done'))
  .catch(async (err) => {
  console.error(err);
  await react('confused');
  await reply(
    err instanceof UserError
      ? `**Taiga sync failed.** ${err.message}`
      : `**Taiga sync failed** with an unexpected error. See the [workflow run](https://github.com/${OWNER}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}) for details.\n\n\`\`\`\n${String(err.message).slice(0, 500)}\n\`\`\``
  );
  process.exit(1);
});
