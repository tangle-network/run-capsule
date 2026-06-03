/**
 * @tangle-network/run-capsule
 *
 * Turn any agent run's trace into a shareable video. Consumer of
 * @tangle-network/agent-eval/storyboard: the substrate compiles the trace into
 * the Storyboard/CodeEdit IR; this package renders rich capsule animations
 * (code / terminal / screen / unified replay), records them headless, and
 * uploads to a temp link.
 *
 *   import { runToVideo } from '@tangle-network/run-capsule'
 *   const { results } = await runToVideo(spans, { title, outDir: 'out' })
 *   // results[].url → shareable links
 *
 * Per agent surface, write one adapter that maps your run into `Span[]` (see
 * adapters/), then everything downstream is uniform + free.
 */

export { runToVideo, supportedKinds } from './run-to-video.js'
export type { CapsuleKind, CapsuleResult, RunToVideoOptions } from './run-to-video.js'

export { recordHtmlToVideo } from './record.js'
export type { RecordVideoOptions } from './record.js'
export { uploadToShareHost } from './upload.js'
export type { ShareHost, LitterboxExpiry, UploadOptions } from './upload.js'

export { renderCodeCapsuleHtml } from './renderers/code-capsule.js'
export type { CodeCapsuleOptions } from './renderers/code-capsule.js'
export { renderTerminalCapsuleHtml, terminalStepsFromSpans } from './renderers/terminal-capsule.js'
export type { TerminalStep, TerminalCapsuleOptions } from './renderers/terminal-capsule.js'
export { renderScreenCapsuleHtml, screenStepsFromSpans } from './renderers/screen-capsule.js'
export type { ScreenStep, ScreenCapsuleOptions } from './renderers/screen-capsule.js'
export { renderConversationCapsuleHtml, conversationStepsFromSpans } from './renderers/conversation-capsule.js'
export type { ConversationTurn, ConversationCapsuleOptions } from './renderers/conversation-capsule.js'

// Redact secrets from a trace before it is published (called by runToVideo).
export { redactSpans } from './redact.js'

// Directing pass — narrative-aware shot timing for the replay capsule.
export { directStoryboard } from './direct.js'
export type { DirectOptions } from './direct.js'

// Composition — sequence per-capsule clips into one film.
export { autoCompose, renderCompositionHtml, renderCardHtml } from './composition.js'
export type { Composition, Shot, ShotLayer, LayerFrame, Transition, AutoComposeOptions } from './composition.js'

// Orbit (rendered-model spin) + agent-generated media layers (video/doc).
export { renderOrbitCapsuleHtml } from './renderers/orbit-capsule.js'
export type { OrbitCapsuleOptions } from './renderers/orbit-capsule.js'
export { renderVideoLayerHtml, renderDocLayerHtml, renderImageRevealHtml } from './renderers/media-layer.js'
export type { ImageRevealOptions } from './renderers/media-layer.js'

// Multi-modal artifacts + audio (narration / music / mux).
export { extractArtifacts, buildNarrationScript } from './artifacts.js'
export type { RunArtifacts, MediaArtifact } from './artifacts.js'
export { synthesizeNarration, musicBed, muxAudioOntoVideo } from './audio.js'
export type { AudioTrack, NarrationConfig } from './audio.js'

// Per-surface adapters — map a given agent surface's output into Span[]. Write
// one of these per surface; everything downstream (capsules, record, upload) is
// then uniform.
export { spansFromWorkdir } from './adapters/workdir.js'
export type { WorkdirSpansOptions } from './adapters/workdir.js'
export { spansFromPlaywrightResult } from './adapters/playwright.js'
export { spansFromComputerUse } from './adapters/computer-use.js'
export type { ComputerUseStep } from './adapters/computer-use.js'
export { spansFromClaudeMessages } from './adapters/claude-messages.js'
export { spansFromRuntimeEvents } from './adapters/runtime-events.js'

// Re-export the substrate IR for convenience so consumers need a single import.
export {
  reduceToSemanticEvents,
  compileStoryboard,
  extractCodeEdits,
  renderStoryboardHtml,
  renderStoryboardMarkdown,
} from '@tangle-network/agent-eval/storyboard'
export type { CodeEdit, Storyboard, SemanticEvent, SceneVisual } from '@tangle-network/agent-eval/storyboard'
