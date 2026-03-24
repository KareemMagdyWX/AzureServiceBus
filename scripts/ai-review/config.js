import { reviewerAgent } from "./agents/reviewer/index.js";
import { debuggerAgent } from "./agents/debugger/index.js";
import { securityAgent } from "./agents/security/index.js";

export const allAgents = [
  reviewerAgent,
  debuggerAgent,
  securityAgent,
];

const agentToggle = {
  "Code Reviewer": true,
  "Bug Debugger": false,
  "Security Scanner": false,
};

export const activeAgents = allAgents.filter(
  (agent) => agentToggle[agent.name] !== false
);
