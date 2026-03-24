import { collectDiffs } from "./core/diffCollector.js";
import { postReviewComment } from "./core/github.js";
import { activeAgents } from "./config.js";

async function main() {
  console.log("🔍 Collecting changed .NET files...\n");

  const { payload, fileCount } = collectDiffs();

  if (fileCount === 0) {
    console.log("\nℹ️  No reviewable .NET files changed – skipping.");
    return;
  }

  console.log(`\n📦 ${fileCount} file(s) collected.`);
  console.log(`🤖 Running ${activeAgents.length} agent(s): ${activeAgents.map((a) => a.name).join(", ")}\n`);

  const results = [];

  for (const agent of activeAgents) {
    try {
      console.log(`▶️  Running agent: ${agent.name}...`);
      const output = await agent.run(payload);
      results.push({ name: agent.name, icon: agent.icon, output });
      console.log(`✅ ${agent.name} finished.`);
    } catch (err) {
      console.error(`❌ ${agent.name} failed:`, err.message);
      results.push({
        name: agent.name,
        icon: agent.icon,
        output: `⚠️ Agent failed: ${err.message}`,
      });
    }
  }

  // Combine all agent outputs into a single PR comment
  const combined = results
    .map((r) => `### ${r.icon} ${r.name}\n\n${r.output}`)
    .join("\n\n---\n\n");

  console.log("\n📝 Posting combined review to GitHub...\n");
  await postReviewComment(combined);

  console.log("🎉 Done!");
}

main().catch((err) => {
  console.error("❌ Pipeline failed:", err);
  process.exit(1);
});
