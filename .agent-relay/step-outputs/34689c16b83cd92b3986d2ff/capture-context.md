
---SAGE SIGNALS---
../sage/README.md:13:3. **Remembers** — persistent memory across conversations via Supermemory
../sage/README.md:26:                                    └── Supermemory (persistent memory)
../sage/README.md:46:- Supermemory API key
../sage/README.md:65:| `SUPERMEMORY_API_KEY` | [supermemory.ai](https://supermemory.ai) | Persistent memory |
../sage/README.md:75:1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch
../sage/README.md:84:6. Set Request URL to your public URL + `/api/webhooks/slack`
../sage/README.md:95:https://your-ngrok-id.ngrok.io/api/webhooks/slack
../sage/README.md:125:├── slack.ts               # Slack signature verification + event parsing
../sage/README.md:127:├── memory.ts              # Supermemory persistence layer
../sage/src/skills/review-router.ts:42:  /(?:\b(auth|oauth|sso|rbac|permission|secrets?|api[_ -]?keys?|credentials?|passwords?|tokens?|jwt|session|cookie|csrf|encryption|kms|vault|pii|user data|customer data|email addresses?|billing|payment|profile|account)\b|(?:^|[^a-z0-9_])\.env(?:\.[a-z0-9_-]+)?(?:$|[^a-z0-9_]))/i;
../sage/src/skills/plan-reviewers/security.ts:6:  /(?:\b(auth|oauth|session|tokens?|jwt|secrets?|credentials?|passwords?|cookie|api[_ -]?keys?|pii|personal data|user data|permission|rbac|acl|webhook|payment|billing)\b|(?:^|[^a-z0-9_])\.env(?:\.[a-z0-9_-]+)?(?:$|[^a-z0-9_]))/i;
../sage/src/memory.ts:1:import { createMemoryAdapter } from '@agent-relay/memory';
../sage/src/memory.ts:2:import type { MemoryAdapter, MemoryEntry } from '@agent-relay/memory';
../sage/src/memory.ts:8:const SUPERMEMORY_ENDPOINT = process.env.SUPERMEMORY_ENDPOINT ?? 'https://api.supermemory.ai';
../sage/src/memory.ts:11:interface SupermemoryFilter {
../sage/src/memory.ts:16:interface SupermemoryListRequest {
../sage/src/memory.ts:21:    AND: SupermemoryFilter[];
../sage/src/memory.ts:25:interface SupermemoryDocument {
../sage/src/memory.ts:34:interface SupermemoryListResponse {
../sage/src/memory.ts:35:  documents?: SupermemoryDocument[];
../sage/src/memory.ts:45:      type: 'supermemory',
../sage/src/memory.ts:57:      this.logError('Failed to initialize memory adapter', error);
../sage/src/memory.ts:63:      ...rows.filter((m) => m.sessionId === threadId),
../sage/src/memory.ts:64:      ...rows.filter((m) => !m.sessionId),
../sage/src/memory.ts:69:    await this.add(summary, { sessionId: threadId, tags: [...BASE_TAGS, ...tags] });
../sage/src/memory.ts:72:  async saveWorkspaceContext(summary: string, tags: string[] = [], sessionId?: string): Promise<void> {
../sage/src/memory.ts:73:    await this.add(summary, { sessionId, tags: [...BASE_TAGS, 'workspace', ...tags] });
../sage/src/memory.ts:91:      this.logError('Supermemory list failed; falling back to search', error);
../sage/src/memory.ts:97:      this.logError('Supermemory search fallback failed', error);
../sage/src/memory.ts:108:    const body: SupermemoryListRequest = {
../sage/src/memory.ts:133:        `Supermemory list request failed: ${error instanceof Error ? error.message : String(error)}`,
../sage/src/memory.ts:138:      throw new Error(`Supermemory list failed (${response.status}): ${await response.text()}`);
../sage/src/memory.ts:141:    const payload = (await response.json()) as SupermemoryListResponse;
../sage/src/memory.ts:175:        `Supermemory search request failed: ${error instanceof Error ? error.message : String(error)}`,
../sage/src/memory.ts:180:      throw new Error(`Supermemory search failed (${response.status}): ${await response.text()}`);
../sage/src/memory.ts:183:    const payload = (await response.json()) as SupermemoryListResponse;
../sage/src/memory.ts:187:  private toMemoryEntry(doc: SupermemoryDocument): MemoryEntry {
../sage/src/memory.ts:197:      sessionId: this.readString(metadata.sessionId),
../sage/src/memory.ts:223:    return `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`;
../sage/src/memory.ts:227:    console.error(`[sage][memory] ${message}:`, error);
../sage/src/memory.ts:230:  private async add(content: string, options: { sessionId?: string; tags: string[] }): Promise<void> {
../sage/src/memory.ts:235:        sessionId: options.sessionId,
../sage/src/memory.ts:240:        this.logError('Failed to save memory', result.error ?? 'Failed to save memory');
../sage/src/memory.ts:243:      this.logError('Failed to save memory', error);
../sage/src/proactive/context-watcher.ts:4:import type { SageMemory } from "../memory.js";
../sage/src/proactive/context-watcher.ts:6:import { postSlackMessageChunkedViaNango } from "../slack.js";
../sage/src/proactive/context-watcher.ts:12:const SUPERMEMORY_ENDPOINT = env.SUPERMEMORY_ENDPOINT ?? "https://api.supermemory.ai";
../sage/src/proactive/context-watcher.ts:29:interface SupermemoryFilter {
../sage/src/proactive/context-watcher.ts:34:interface SupermemoryDocument {
../sage/src/proactive/context-watcher.ts:41:interface SupermemoryListResponse {
../sage/src/proactive/context-watcher.ts:42:  documents?: SupermemoryDocument[];
../sage/src/proactive/context-watcher.ts:104:function getWorkspaceId(memory: SageMemory): string | undefined {
../sage/src/proactive/context-watcher.ts:105:  return readString((memory as unknown as { workspaceId?: unknown }).workspaceId);
../sage/src/proactive/context-watcher.ts:150:    console.warn("[proactive/context-watch] SUPERMEMORY_API_KEY is not set");
../sage/src/proactive/context-watcher.ts:154:  const filters: SupermemoryFilter[] = [
../sage/src/proactive/context-watcher.ts:177:    console.error("[proactive/context-watch] Supermemory list request failed", error);
../sage/src/proactive/context-watcher.ts:182:    console.error("[proactive/context-watch] Supermemory list failed", response.status, await response.text());
../sage/src/proactive/context-watcher.ts:186:  const payload = (await response.json()) as SupermemoryListResponse;
../sage/src/proactive/context-watcher.ts:236:  memory: SageMemory,
../sage/src/proactive/context-watcher.ts:238:  slackConnectionId: string,
../sage/src/proactive/context-watcher.ts:242:    console.warn("[proactive/context-watch] No notification channel configured");
../sage/src/proactive/context-watcher.ts:246:  const workspaceId = getWorkspaceId(memory);
../sage/src/proactive/context-watcher.ts:248:    console.warn("[proactive/context-watch] Could not determine workspace ID");
../sage/src/proactive/context-watcher.ts:254:    console.log("[proactive/context-watch] No research topics found");
../sage/src/proactive/context-watcher.ts:288:          slackConnectionId,
../sage/src/proactive/context-watcher.ts:293:          console.warn(`[proactive/context-watch] Failed to post topic update for "${topic.topic}": ${result.error}`);
../sage/src/proactive/context-watcher.ts:298:        await memory.saveWorkspaceContext(
../sage/src/proactive/context-watcher.ts:306:        await memory.saveWorkspaceContext(
../sage/src/proactive/context-watcher.ts:312:      console.error(`[proactive/context-watch] Failed to inspect topic "${topic.topic}"`, error);
../sage/src/proactive/context-watcher.ts:316:  console.log(`[proactive/context-watch] Sent ${notifications} context notification(s)`);
../sage/src/proactive/follow-up-checker.ts:5:import type { SageMemory } from "../memory.js";
../sage/src/proactive/follow-up-checker.ts:7:import { postSlackMessageChunkedViaNango } from "../slack.js";
../sage/src/proactive/follow-up-checker.ts:12:const FOLLOW_UP_TAG = "proactive-follow-up-sent";
../sage/src/proactive/follow-up-checker.ts:13:const FOLLOW_UP_ITEM_TAG = "proactive-follow-up-item";
../sage/src/proactive/follow-up-checker.ts:16:const SUPERMEMORY_ENDPOINT = env.SUPERMEMORY_ENDPOINT ?? "https://api.supermemory.ai";
../sage/src/proactive/follow-up-checker.ts:25:const FOLLOW_UP_SYSTEM_PROMPT = `You decide whether Sage should send a proactive follow-up about an older Slack thread.
../sage/src/proactive/follow-up-checker.ts:37:interface SupermemoryFilter {
../sage/src/proactive/follow-up-checker.ts:42:interface SupermemoryDocument {
../sage/src/proactive/follow-up-checker.ts:50:interface SupermemoryListResponse {
../sage/src/proactive/follow-up-checker.ts:51:  documents?: SupermemoryDocument[];
../sage/src/proactive/follow-up-checker.ts:58:  sessionId?: string;
../sage/src/proactive/follow-up-checker.ts:77:  slackBotUserId?: string;
../sage/src/proactive/follow-up-checker.ts:113:  return `follow-up-${Date.now()}-${Math.random().toString(16).slice(2)}`;
../sage/src/proactive/follow-up-checker.ts:148:function toMemoryDoc(document: SupermemoryDocument): MemoryDoc {
../sage/src/proactive/follow-up-checker.ts:155:    sessionId: readString(metadata.sessionId),
../sage/src/proactive/follow-up-checker.ts:160:function getWorkspaceId(memory: SageMemory): string | undefined {
../sage/src/proactive/follow-up-checker.ts:161:  return readString((memory as unknown as { workspaceId?: unknown }).workspaceId);
../sage/src/proactive/follow-up-checker.ts:165:  return readString(metadata.channel) ?? readString(metadata.slackChannel);
../sage/src/proactive/follow-up-checker.ts:175:    const sessionId = readString(parsed.sessionId) ?? readString(parsed.threadTs);
../sage/src/proactive/follow-up-checker.ts:176:    const threadTs = readString(parsed.threadTs) ?? sessionId;
../sage/src/proactive/follow-up-checker.ts:178:    if (!sessionId || !threadTs || !question) {
../sage/src/proactive/follow-up-checker.ts:183:      id: readString(parsed.id) ?? sessionId,
../sage/src/proactive/follow-up-checker.ts:184:      sessionId,
../sage/src/proactive/follow-up-checker.ts:271:    const sessionId = document.sessionId ?? extractThreadTs(document.metadata);
../sage/src/proactive/follow-up-checker.ts:272:    if (!sessionId) {
../sage/src/proactive/follow-up-checker.ts:282:      sessionId,
../sage/src/proactive/follow-up-checker.ts:289:    const current = latestByThread.get(sessionId);
../sage/src/proactive/follow-up-checker.ts:291:      latestByThread.set(sessionId, candidate);
../sage/src/proactive/follow-up-checker.ts:303:    console.warn("[proactive/follow-ups] SUPERMEMORY_API_KEY is not set");
../sage/src/proactive/follow-up-checker.ts:307:  const filters: SupermemoryFilter[] = [
../sage/src/proactive/follow-up-checker.ts:330:    console.error("[proactive/follow-ups] Supermemory list request failed", error);
../sage/src/proactive/follow-up-checker.ts:335:    console.error("[proactive/follow-ups] Supermemory list failed", response.status, await response.text());
../sage/src/proactive/follow-up-checker.ts:339:  const payload = (await response.json()) as SupermemoryListResponse;
../sage/src/proactive/follow-up-checker.ts:357:          `Session ID: ${candidate.sessionId}`,
../sage/src/proactive/follow-up-checker.ts:415:  const threadTs = candidate.threadTs ?? candidate.sessionId;
../sage/src/proactive/follow-up-checker.ts:421:      sessionId: candidate.sessionId,
../sage/src/proactive/follow-up-checker.ts:432:    sessionId: candidate.sessionId,
../sage/src/proactive/follow-up-checker.ts:446:export async function persistItem(memory: SageMemory, item: FollowUpItem): Promise<void> {
../sage/src/proactive/follow-up-checker.ts:447:  await memory.saveWorkspaceContext(JSON.stringify(item), [FOLLOW_UP_ITEM_TAG]);
../sage/src/proactive/follow-up-checker.ts:514:        action: "send-follow-up",
../sage/src/proactive/follow-up-checker.ts:529:function persistLegacyMarker(memory: SageMemory, threadId: string, questionSummary: string): Promise<void> {
../sage/src/proactive/follow-up-checker.ts:530:  return memory.saveWorkspaceContext(
../sage/src/proactive/follow-up-checker.ts:531:    `thread=${threadId} question=${questionSummary || "unresolved follow-up"}`,
../sage/src/proactive/follow-up-checker.ts:546:  memory: SageMemory,
../sage/src/proactive/follow-up-checker.ts:548:  slackConnectionId: string,
../sage/src/proactive/follow-up-checker.ts:552:  const workspaceId = getWorkspaceId(memory);
../sage/src/proactive/follow-up-checker.ts:554:    console.warn("[proactive/follow-ups] Could not determine workspace ID");
../sage/src/proactive/follow-up-checker.ts:560:    throw new Error("Evidence collector is required for follow-up checks");
../sage/src/proactive/follow-up-checker.ts:578:      memory,
../sage/src/proactive/follow-up-checker.ts:580:      slackConnectionId,
../sage/src/proactive/follow-up-checker.ts:581:      slackBotUserId: options.slackBotUserId,
../sage/src/proactive/follow-up-checker.ts:596:            slackConnectionId,
../sage/src/proactive/follow-up-checker.ts:601:            console.warn(`[proactive/follow-ups] Failed to post closure note for ${item.threadTs}: ${result.error}`);
../sage/src/proactive/follow-up-checker.ts:605:        await persistItem(memory, evaluated.next);
../sage/src/proactive/follow-up-checker.ts:612:        await persistItem(memory, evaluated.next);
../sage/src/proactive/follow-up-checker.ts:617:      if (evaluated.action === "send-follow-up") {
../sage/src/proactive/follow-up-checker.ts:628:          slackConnectionId,
../sage/src/proactive/follow-up-checker.ts:633:          console.warn(`[proactive/follow-ups] Failed to post follow-up for ${item.threadTs}: ${result.error}`);
../sage/src/proactive/follow-up-checker.ts:645:        await persistItem(memory, persistedItem);
../sage/src/proactive/follow-up-checker.ts:646:        await persistLegacyMarker(memory, item.threadTs, evaluated.questionSummary ?? persistedItem.question);
../sage/src/proactive/follow-up-checker.ts:667:          slackConnectionId,
../sage/src/proactive/follow-up-checker.ts:672:          console.warn(`[proactive/follow-ups] Failed to post stale ping for ${item.threadTs}: ${result.error}`);
../sage/src/proactive/follow-up-checker.ts:686:        await persistItem(memory, persistedItem);
../sage/src/proactive/follow-up-checker.ts:693:        await persistItem(memory, evaluated.next);
../sage/src/proactive/follow-up-checker.ts:697:      console.error(`[proactive/follow-ups] Failed to process ${item.threadTs}`, error);
../sage/src/proactive/follow-up-checker.ts:702:    `[proactive/follow-ups] sent=${stats.sent} closed=${stats.closed} pinged=${stats.pinged}`,
../sage/src/proactive/types.ts:1:import type { SageMemory } from "../memory.js";
../sage/src/proactive/types.ts:3:import type { ThreadMessage } from "../slack.js";
../sage/src/proactive/types.ts:9:export type FollowUpAction = "send-follow-up" | "close" | "likely-done" | "open" | "ping-stale";
../sage/src/proactive/types.ts:20:  sessionId: string;
../sage/src/proactive/types.ts:29:  sessionId: string;
../sage/src/proactive/types.ts:45:  action: Exclude<FollowUpAction, "send-follow-up">;
../sage/src/proactive/types.ts:51:  memory: SageMemory;
../sage/src/proactive/types.ts:53:  slackConnectionId: string;
../sage/src/proactive/types.ts:54:  slackBotUserId?: string;
../sage/src/proactive/engine.ts:6:import { SageMemory } from "../memory.js";
../sage/src/proactive/engine.ts:9:import { getFollowUpEvidenceCollector } from "./follow-up-collector.js";
../sage/src/proactive/engine.ts:10:import { checkFollowUps } from "./follow-up-checker.js";
../sage/src/proactive/engine.ts:12:import { detectStaleThreads } from "./stale-thread-detector.js";
../sage/src/proactive/engine.ts:18:  resolveSlackBotUserId?: (slackConnectionId: string) => Promise<string | undefined>;
../sage/src/proactive/engine.ts:22:  slackBotUserId?: string;
../sage/src/proactive/engine.ts:94:  slackConnectionId: string;
../sage/src/proactive/engine.ts:95:  slackBotUserId?: string;
../sage/src/proactive/engine.ts:98:  const slackConnectionId = await config.resolveSlackConnectionId(workspaceId);
../sage/src/proactive/engine.ts:99:  if (!slackConnectionId) {
../sage/src/proactive/engine.ts:105:    slackConnectionId,
../sage/src/proactive/engine.ts:106:    slackBotUserId: config.resolveSlackBotUserId
../sage/src/proactive/engine.ts:107:      ? await config.resolveSlackBotUserId(slackConnectionId)
../sage/src/proactive/engine.ts:108:      : config.slackBotUserId,
../sage/src/proactive/engine.ts:116:  routes.post("/follow-ups", async (c) => {
../sage/src/proactive/engine.ts:119:      const { workspaceId, slackConnectionId, slackBotUserId } = await resolveSlackContext(config, body);
../sage/src/proactive/engine.ts:126:        slackConnectionId,
../sage/src/proactive/engine.ts:130:          slackBotUserId,
../sage/src/proactive/engine.ts:139:      console.error("[proactive] Follow-up check failed:", error);
../sage/src/proactive/engine.ts:144:  routes.post("/stale-threads", async (c) => {
../sage/src/proactive/engine.ts:147:      const { workspaceId, slackConnectionId, slackBotUserId } = await resolveSlackContext(config, body);
../sage/src/proactive/engine.ts:152:        slackConnectionId,
../sage/src/proactive/engine.ts:154:        slackBotUserId,
../sage/src/proactive/engine.ts:162:      console.error("[proactive] Stale thread detection failed:", error);
../sage/src/proactive/engine.ts:170:      const { workspaceId, slackConnectionId } = await resolveSlackContext(config, body);
../sage/src/proactive/engine.ts:174:        slackConnectionId,
../sage/src/proactive/engine.ts:182:      console.error("[proactive] Context watch failed:", error);
../sage/src/proactive/engine.ts:200:      const { slackConnectionId } = await resolveSlackContext(config, body);
../sage/src/proactive/engine.ts:205:        slackConnectionId,
../sage/src/proactive/engine.ts:219:      console.error("[proactive] PR match failed:", error);
../sage/src/proactive/stale-thread-detector.ts:4:import type { SageMemory } from "../memory.js";
../sage/src/proactive/stale-thread-detector.ts:6:import { fetchThreadHistoryViaNango, postSlackMessageChunkedViaNango } from "../slack.js";
../sage/src/proactive/stale-thread-detector.ts:14:const STALE_THREAD_ALERT_TAG = "proactive-stale-thread-alert";
../sage/src/proactive/stale-thread-detector.ts:15:const SUPERMEMORY_ENDPOINT = env.SUPERMEMORY_ENDPOINT ?? "https://api.supermemory.ai";
../sage/src/proactive/stale-thread-detector.ts:20:const STALE_THREAD_SYSTEM_PROMPT = `You review a Slack thread that Sage participated in and decide whether it deserves a stale-thread alert.
../sage/src/proactive/stale-thread-detector.ts:42:interface SupermemoryFilter {
../sage/src/proactive/stale-thread-detector.ts:47:interface SupermemoryDocument {
../sage/src/proactive/stale-thread-detector.ts:52:interface SupermemoryListResponse {
../sage/src/proactive/stale-thread-detector.ts:53:  documents?: SupermemoryDocument[];
../sage/src/proactive/stale-thread-detector.ts:153:  const filters: SupermemoryFilter[] = [
../sage/src/proactive/stale-thread-detector.ts:176:    console.error("[proactive/stale-threads] Supermemory list request failed", error);
../sage/src/proactive/stale-thread-detector.ts:181:    console.error("[proactive/stale-threads] Supermemory list failed", response.status, await response.text());
../sage/src/proactive/stale-thread-detector.ts:185:  const payload = (await response.json()) as SupermemoryListResponse;
../sage/src/proactive/stale-thread-detector.ts:207:  slackConnectionId: string,
../sage/src/proactive/stale-thread-detector.ts:216:    connectionId: slackConnectionId,
../sage/src/proactive/stale-thread-detector.ts:217:    providerConfigKey: "slack",
../sage/src/proactive/stale-thread-detector.ts:257:  memory: SageMemory,
../sage/src/proactive/stale-thread-detector.ts:260:  slackConnectionId: string,
../sage/src/proactive/stale-thread-detector.ts:262:  slackBotUserId?: string,
../sage/src/proactive/stale-thread-detector.ts:266:    console.log("[proactive/stale-threads] No active threads to inspect");
../sage/src/proactive/stale-thread-detector.ts:279:    console.log(`[proactive/stale-threads] No active threads to inspect for workspace "${workspaceId}"`);
../sage/src/proactive/stale-thread-detector.ts:298:        slackBotUserId,
../sage/src/proactive/stale-thread-detector.ts:300:        slackConnectionId,
../sage/src/proactive/stale-thread-detector.ts:307:      const lastActivityMs = await fetchLastActivityMs(ref, nangoClient, slackConnectionId);
../sage/src/proactive/stale-thread-detector.ts:323:        slackConnectionId,
../sage/src/proactive/stale-thread-detector.ts:328:        console.warn(`[proactive/stale-threads] Failed to post alert for ${ref.threadTs}: ${result.error}`);
../sage/src/proactive/stale-thread-detector.ts:336:      await memory.saveWorkspaceContext(
../sage/src/proactive/stale-thread-detector.ts:341:      console.error(`[proactive/stale-threads] Failed to inspect ${ref.threadTs}`, error);
../sage/src/proactive/stale-thread-detector.ts:345:  console.log(`[proactive/stale-threads] Sent ${alerts} stale-thread alert(s)`);
../sage/src/proactive/scheduler.ts:207:    name: "sage-follow-ups",
../sage/src/proactive/scheduler.ts:209:    path: "/api/proactive/follow-ups",
../sage/src/proactive/scheduler.ts:210:    description: "Checks for unresolved questions that need a proactive follow-up.",
../sage/src/proactive/scheduler.ts:213:    name: "sage-stale-threads",
../sage/src/proactive/scheduler.ts:215:    path: "/api/proactive/stale-threads",
../sage/src/proactive/scheduler.ts:221:    path: "/api/proactive/context-watch",
../sage/src/proactive/scheduler.ts:275:      "[proactive/scheduler] Skipping schedule registration:",
../sage/src/proactive/scheduler.ts:286:      "[proactive/scheduler] Failed to load existing schedules; skipping registration to avoid duplicates:",
../sage/src/proactive/scheduler.ts:305:      purpose: "proactive-engine",
../sage/src/proactive/scheduler.ts:321:        console.log(`[proactive/scheduler] Updated schedule ${definition.name}`);
../sage/src/proactive/scheduler.ts:333:        console.log(`[proactive/scheduler] Created schedule ${definition.name}`);
../sage/src/proactive/scheduler.ts:337:        `[proactive/scheduler] Failed to register ${definition.name}:`,
../sage/src/proactive/evidence-sources/explicit-close-source.ts:2:import { fetchThreadHistoryViaNango } from "../../slack.js";
../sage/src/proactive/evidence-sources/explicit-close-source.ts:23:        ctx.slackBotUserId,
../sage/src/proactive/evidence-sources/explicit-close-source.ts:25:        ctx.slackConnectionId,
../sage/src/proactive/evidence-sources/explicit-close-source.ts:35:        if (!targetId || (targetId !== item.id && targetId !== item.sessionId && targetId !== item.threadTs)) {

---MSD SIGNALS---
