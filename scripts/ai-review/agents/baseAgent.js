import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

/**
 * Creates an agent with a standardized interface.
 *
 * Every agent must provide:
 *   - name:         Display name shown in the PR comment
 *   - icon:         Emoji prefix
 *   - systemPrompt: Instructions for Claude
 *   - userPrompt:   Function that receives the diff payload and returns the user message
 *   - model:        (optional) Override the default model
 *   - maxTokens:    (optional) Override the default max tokens
 */
export function createAgent({
  name,
  icon,
  systemPrompt,
  userPrompt,
  model = "claude-sonnet-4-20250514",
  maxTokens = 4096,
}) {
  return {
    name,
    icon,

    async run(diffsPayload) {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt(diffsPayload),
          },
        ],
      });

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      if (!text) throw new Error(`${name} returned an empty response.`);

      return text;
    },
  };
}
