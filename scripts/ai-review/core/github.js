/**
 * Posts (or updates) a combined AI review comment on a GitHub PR.
 */

const COMMENT_MARKER = "<!-- ai-dotnet-review -->";

async function findExistingComment(repo, prNumber, token) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );
  if (!res.ok) return null;

  const comments = await res.json();
  return comments.find((c) => c.body?.includes(COMMENT_MARKER)) ?? null;
}

export async function postReviewComment(reviewMarkdown) {
  const { GITHUB_TOKEN, PR_NUMBER, REPO } = process.env;

  const body = [
    COMMENT_MARKER,
    "## 🤖 AI Code Review (.NET)\n",
    reviewMarkdown,
    "\n---",
    "<sub>Powered by Claude Agents · auto-triggered on PR to <code>main</code></sub>",
  ].join("\n");

  const existing = await findExistingComment(REPO, PR_NUMBER, GITHUB_TOKEN);

  if (existing) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/issues/comments/${existing.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({ body }),
      }
    );
    if (!res.ok) throw new Error(`GitHub PATCH failed: ${res.status}`);
    console.log(`✏️  Updated existing comment on PR #${PR_NUMBER}`);
  } else {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/issues/${PR_NUMBER}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({ body }),
      }
    );
    if (!res.ok) throw new Error(`GitHub POST failed: ${res.status}`);
    console.log(`✅ Posted review to PR #${PR_NUMBER}`);
  }
}
