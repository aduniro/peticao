import { readCredentialText } from "../mail/smtp-credential";
/** No CLI/chat auth or general key vault fallback. Called lazily only when service/config gates permit. */
export function openAiCredential(): string | null {
  const value = process.env.OPENAI_API_KEY ?? readCredentialText("openai-api");
  return typeof value === "string" && /^[A-Za-z0-9._-]{20,1024}$/.test(value) ? value : null;
}
export const aiServiceArmed = () => process.env.AI_EXECUTION_ENABLED === "1";
/** Configured to attempt, not proof of provider account access/credit or model availability. */
export const aiExecutionAvailable = (enabled: boolean) => enabled && aiServiceArmed() && !!openAiCredential();
