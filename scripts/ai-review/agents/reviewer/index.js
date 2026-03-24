import { createAgent } from "../baseAgent.js";
import { systemPrompt, userPrompt } from "./prompt.js";

export const reviewerAgent = createAgent({
  name: "Code Reviewer",
  icon: "📝",
  systemPrompt,
  userPrompt,
});
