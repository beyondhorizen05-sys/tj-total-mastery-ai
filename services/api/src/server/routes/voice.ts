import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SettingsRepo } from '../../db/repo.js';
import type { EventBus } from '../../core/event-bus.js';
import type { HealthMonitor } from '../../core/health.js';
import type { Orchestrator } from '../../orchestrator/orchestrator.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { AgentRuntime } from '../../agents/runtime.js';
import type { AgentService } from '../../agents/service.js';
import type { ApprovalService } from '../../security/approvals.js';
import { VoiceListener, listLocalVoices, speakLocally } from '../../core/voice-listener.js';
import { computerAvailable, runComputerBridge } from '../../tools/builtin/computer.js';
import type { Vault } from '../../security/vault.js';
import type { ModelRouter } from '../../models/router.js';
import { FishAudioService } from '../../core/fish-audio.js';
import { FishHandsFreeListener } from '../../core/fish-listener.js';
import { LocalASR } from '../../core/local-asr.js';
import { VoiceTurnGate } from '../../core/voice-turn-gate.js';
import { getPersona, personaInstruction } from '../../core/persona.js';
import { WAKE, isComputerIntent, isScreenObservationCommand, isVisualScreenCommand, takeSpeakableChunk } from '../../core/voice-intent.js';
import type { CapabilityWorkflowService } from '../../self-improvement/capability-workflow.js';
import type { WorkflowEngine } from '../../workflows/engine.js';
import type { AutomationScheduler } from '../../workflows/automation-scheduler.js';

type Deps = { settings: SettingsRepo; bus: EventBus; health: HealthMonitor; orchestrator: Orchestrator; tools: ToolRegistry; runtime: AgentRuntime; agents: AgentService; approvals: ApprovalService; vault: Vault; router: ModelRouter; dataDir: string; capabilityWorkflow?: CapabilityWorkflowService; workflowEngine: WorkflowEngine; scheduler: AutomationScheduler };
const commandSchema = z.object({ text: z.string().trim().min(1).max(2000) });

export function registerVoiceRoutes(app: FastifyInstance, deps: Deps) {
  let busy = false;
  let conversing = false;
  let browserVoiceActive = false;
  let browserSpeaking = false;
  let browserASRProvider: 'local' | 'fish' | null = null;
  const browserTurnGate = new VoiceTurnGate();
  const approvalCodes = new Map<string, string>();
  const languageContext = new AsyncLocalStorage<string | null>();
  const fish = new FishAudioService(deps.vault, deps.settings);
  const localASR = new LocalASR(deps.dataDir, () => deps.settings.get<'fast' | 'accurate'>('voice_recognition_mode', 'fast'));
  const handsfreeMode = () => deps.settings.get<boolean>('voice_handsfree_mode', false);
  const asrProvider = () => deps.settings.get<'local' | 'fish'>('voice_asr_provider', 'local');
  const voiceUsesDefaultModel = () => deps.settings.get<boolean>('voice_use_default_model', false);
  const welcomeText = (locale: string) => /^ur(?:-|$)/i.test(locale)
    ? 'Khush aamdeed. Main TJ hoon. Mujhe khushi hai ke aap yahan hain. Yeh aapki apni jagah hai. Apne khayal aur khwab mere saath baantiye. Hum mil kar inhein haqeeqat banayenge. Chaliye, mustaqbil mein qadam rakhte hain.'
    : "Welcome. I'm TJ. I'm so glad you're here. This is your space to think bigger, create freely, and make what matters to you real. Take a breath. The future is open, and we'll step into it together.";
  const welcomeVoice = () => {
    const saved = deps.settings.get<string | null>('welcome_voice_id', null);
    if (saved) return saved;
    const persona = getPersona(deps.settings);
    const selected = persona.voice_id;
    if (selected?.startsWith('fish:')) return selected;
    return persona.embodiment === 'male' ? 'neural:guy' : 'neural:jenny';
  };
  const welcomePlayed = () => deps.settings.get<number>('welcome_greeting_version', 0) >= 2;
  const currentListener = () => handsfreeMode() ? asrProvider() === 'fish' ? fishListener : localListener : listener;
  const voiceSessionActive = () => browserVoiceActive || currentListener().status().listening;
  let speechQueue = Promise.resolve();
  let speechGeneration = 0;
  let activeSpeech: AbortController | null = null;
  let activeConversation: AbortController | null = null;
  const speak = (message: string, overrideVoice?: string) => {
    const selected = overrideVoice ?? getPersona(deps.settings).voice_id ?? 'neural:jenny';
    if (browserVoiceActive || selected?.startsWith('neural:')) {
      browserSpeaking = true;
      deps.bus.emit({ name: 'voice.response', summary: message, data: { speech_chunk: true, voice_id: selected } });
      return Promise.resolve();
    }
    const generation = speechGeneration;
    speechQueue = speechQueue.catch(() => {}).then(async () => {
      if (generation !== speechGeneration) return;
      const speechController = new AbortController();
      activeSpeech = speechController;
      const handsfree = currentListener();
      const handsfreeActive = handsfree instanceof FishHandsFreeListener && handsfree.status().listening;
      if (handsfreeActive) handsfree.suspend();
      try {
        const spoken = message.replace(/[{}[\]_*#]/g, ' ').trim();
        if (selected?.startsWith('fish:')) await fish.playStreaming(spoken, selected.slice(5), speechController.signal);
        else if (selected?.startsWith('windows:')) await speakLocally(spoken.replace(/\bT\s*J\b/gi, 'Tee Jay'), selected, speechController.signal);
        else {
          deps.bus.emit({ name: 'voice.response', summary: message, data: { speech_chunk: true, voice_id: selected } });
        }
      } catch (error) {
        if (speechController.signal.aborted) return;
        deps.bus.emit({ name: 'voice.error', severity: 'error', summary: error instanceof Error ? error.message : String(error) });
      } finally {
        if (activeSpeech === speechController) activeSpeech = null;
        if (handsfreeActive) handsfree.resume();
      }
    });
    return speechQueue;
  };
  const respond = async (message: string, error = false, localized = false, alreadySpoken = false) => {
    const language = languageContext.getStore();
    if (!localized && language && !/^en(?:-|$)/i.test(language)) {
      try {
        const operatorModel = deps.agents.list().find((agent) => agent.template_id === 'computer_operator')?.model_id;
        const useDefault = browserVoiceActive || voiceUsesDefaultModel();
        const replyModel = useDefault ? deps.settings.get<string | null>('default_model_id', null) : operatorModel;
        const translated = await deps.router.chat({ task_type: 'chat', complexity: 'low', needs_tools: false, prefer: 'cheapest', max_cost_class: useDefault ? undefined : 'free', model_id: replyModel }, {
          messages: [{ role: 'system', content: `Translate the following assistant reply into the user's language (${language}). Return only the translation. Preserve factual claims, IDs, and error meaning. Never add a new action or instruction.` }, { role: 'user', content: message }], max_tokens: 500, temperature: 0.1,
        });
        if (translated.text.trim()) message = translated.text.trim();
      } catch { /* Keep the truthful original response if no model is available. */ }
    }
    deps.bus.emit({ name: error ? 'voice.error' : 'voice.response', severity: error ? 'error' : 'info', summary: message });
    if (!alreadySpoken && voiceSessionActive()) await speak(message.slice(0, 700)).catch(() => {});
    return { ok: !error, response: message };
  };
  const enabled = () => deps.settings.get<boolean>('computer_control_enabled', false) === true && computerAvailable();
  const voiceAvailable = () => process.platform === 'win32';
  const history: Array<{ user: string; assistant: string }> = [];
  const chatHistory: Array<{ user: string; assistant: string }> = [];
  const stopListening = () => { browserTurnGate.invalidate(); listener.stop(); fishListener.stop(); localListener.stop(); };
  const execute = async (tool: string, args: Record<string, unknown>, spokenPhrase = '') => {
    try {
      const result = await deps.tools.execute(tool, args, {
        workspace_id: 'default', project_id: null, project_root: null, agent_id: null,
        agent_permissions: null, task_id: null, workflow_run_id: null,
      });
      if (!result.ok) return respond(result.error ?? result.output, true);
      if (tool === 'computer_observe') {
        const data = result.data as { foreground?: string; elements?: string[] } | undefined;
        const elements = data?.elements ?? [];
        const shown = elements.slice(0, 25);
        const remainder = elements.length > shown.length ? ` ${elements.length - shown.length} more controls were found.` : '';
        if (/[\u0600-\u06ff]/.test(spokenPhrase)) {
          return respond(`سامنے کھلی ونڈو: ${data?.foreground || 'نامعلوم'}۔ مقامی طور پر ملنے والے کنٹرول اور متن: ${shown.join('; ') || 'کوئی نظر نہیں آیا'}۔${elements.length > shown.length ? ` مزید ${elements.length - shown.length} کنٹرول ملے۔` : ''} تصویر کی شکل میں بنا متن رہ سکتا ہے۔`, false, true);
        }
        if (/\b(?:par|pe|dekho|parho|kya)\b/i.test(spokenPhrase)) {
          return respond(`Samne khuli window: ${data?.foreground || 'maloom nahi'}. Local screen reading mein yeh controls aur text milay: ${shown.join('; ') || 'kuch nazar nahi aaya'}.${elements.length > shown.length ? ` Mazeed ${elements.length - shown.length} controls milay.` : ''} Tasveer ki shakal mein bana text miss ho sakta hai.`, false, true);
        }
        return respond(`Focused window: ${data?.foreground || 'unknown'}. Accessible controls and text: ${shown.join('; ') || 'none visible'}.${remainder} This local reading may miss text drawn as pixels.`);
      }
      if (tool === 'computer_read_screen') return respond(result.output || 'The vision model returned no screen description.', !result.output);
      if (tool === 'computer_write') return respond(`I typed the text and verified it is visible in ${String(result.data?.foreground ?? 'the focused app')}.`);
      if (tool === 'computer_screenshot') return respond('Desktop screenshot saved in TJ artifacts.');
      return respond(`${tool.replace('computer_', '')} completed. ${Object.values(args).join(' ')}.`);
    } catch (error) { return respond(error instanceof Error ? error.message : String(error), true); }
  };

  const converse = async (phrase: string) => {
    conversing = true;
    const turnController = new AbortController();
    activeConversation = turnController;
    try {
      const useDefault = browserVoiceActive || voiceUsesDefaultModel();
      const freeModels = useDefault ? [] : deps.router.candidates({ task_type: 'chat', complexity: 'low', max_cost_class: 'free' });
      const preferred = ['openrouter/nvidia/nemotron-3-super-120b-a12b:free', 'openrouter/cohere/north-mini-code:free', 'openrouter/apodex/apodex-1.1-mini:free'];
      const freeModel = preferred.map((id) => freeModels.find((item) => item.id === id)).find(Boolean) ?? freeModels[0];
      const modelId = useDefault ? deps.settings.get<string | null>('default_model_id', null) : freeModel?.id;
      if (!modelId) return respond(useDefault ? 'Choose a default model in Models for voice conversation.' : 'No free conversation model is available. Configure one in Models.', true);
      let streamed = '';
      let spokenLength = 0;
      const voiceActive = voiceSessionActive();
      const route = { task_type: 'chat' as const, complexity: 'low' as const, needs_tools: false, model_id: modelId, max_cost_class: useDefault ? undefined : 'free' as const };
      const messages = [
          { role: 'system', content: `${personaInstruction(getPersona(deps.settings))}\nYou are in a live voice conversation. Reply in one or two short, natural sentences. Start answering immediately. Match the user's language and script. Never claim to have used a tool or seen the screen.` },
          ...chatHistory.slice(-3).flatMap((turn) => [{ role: 'user' as const, content: turn.user }, { role: 'assistant' as const, content: turn.assistant }]),
          { role: 'user', content: phrase },
        ] as const;
      let result = await deps.router.chat(route, {
        messages: [...messages],
        max_tokens: 180,
        temperature: 0.5,
        signal: turnController.signal,
        onDelta: (delta) => {
          if (turnController.signal.aborted) return;
          streamed += delta;
          if (!voiceActive) return;
          const pending = streamed.slice(spokenLength);
          const chunk = takeSpeakableChunk(pending);
          if (chunk) {
            spokenLength += chunk.length;
            void speak(chunk.trim());
          }
        },
      });
      if (turnController.signal.aborted) return { ok: true, response: 'Turn interrupted.' };
      // An empty streamed completion is a provider failure, not a valid answer.
      // Try another free provider without streaming; an explicitly chosen paid
      // model is retried only on itself.
      if (!result.text.trim()) {
        const fallbackId = useDefault ? modelId : freeModels.find((item) => item.id === 'openrouter/cohere/north-mini-code:free' && item.id !== modelId)?.id
          ?? freeModels.find((item) => item.id !== modelId)?.id ?? modelId;
        result = await deps.router.chat({ ...route, model_id: fallbackId }, { messages: [...messages], max_tokens: 180, temperature: 0.5 });
      }
      const answer = result.text.trim();
      if (!answer) return respond('I could not generate a reply. Please try again.', true);
      if (turnController.signal.aborted) return { ok: true, response: 'Turn interrupted.' };
      if (voiceActive) {
        const rest = result.text.slice(spokenLength).trim();
        if (rest) void speak(rest);
      }
      chatHistory.push({ user: phrase, assistant: answer });
      if (chatHistory.length > 6) chatHistory.shift();
      return respond(answer, false, true, voiceActive);
    } catch (error) {
      if (turnController.signal.aborted) return { ok: true, response: 'Turn interrupted.' };
      return respond(error instanceof Error ? error.message : String(error), true);
    }
    finally { conversing = false; if (activeConversation === turnController) activeConversation = null; }
  };

  const command = async (text: string) => {
    const phrase = text.replace(WAKE, '').trim().replace(/[.!?۔؟]$/, '');
    if (!phrase) return respond('Yes. Tell me what to do.');
    if (/^(stop listening|turn off listening|mute microphone)$/i.test(phrase)) { deps.settings.set('voice_autostart', false); stopListening(); return respond('Voice listening stopped.'); }
    if (/^(stop all|emergency stop)$/i.test(phrase)) {
      deps.health.setStopAll(true); deps.scheduler.pause(); deps.workflowEngine.cancelAll(); deps.orchestrator.stopAll(); deps.approvals.denyAllPending('voice_stop_all');
      return respond('All TJ actions stopped.');
    }
    const decisionPhrase = phrase.match(/^(approve|deny)(?: (?:that|action))?(?:\s+(\d{2}))?$/i);
    if (decisionPhrase) {
      const pending = deps.approvals.list('pending');
      if (pending.length !== 1) return respond(`There are ${pending.length} pending approvals. Use the Approvals screen to choose one.`, true);
      const target = pending[0];
      if (target.risk === 'high' || target.risk === 'critical') return respond('This high risk action needs a decision in the Approvals screen.', true);
      const decision = decisionPhrase[1].toLowerCase() === 'approve' ? 'approve_once' : 'deny';
      if (decision === 'approve_once' && (!decisionPhrase[2] || approvalCodes.get(target.id) !== decisionPhrase[2])) return respond('Say approve followed by the two digit code I gave for this action.', true);
      deps.approvals.decide(target.id, decision, 'voice_user');
      approvalCodes.delete(target.id);
      return respond(`${decision === 'approve_once' ? 'Approved' : 'Denied'}: ${target.action} for ${target.target}.`);
    }
    if (deps.health.isStopped()) return respond('TJ is stopped. Resume it in the app before continuing.', true);
    if ((isComputerIntent(phrase) || isScreenObservationCommand(phrase) || isVisualScreenCommand(phrase)) && !enabled()) return respond('Computer control is disabled or the local Windows bridge is unavailable.', true);
    const click = phrase.match(/^click(?: at)?\s+(-?\d+)\s*(?:,|and|by)?\s*(-?\d+)$/i);
    if (click) return execute('computer_click', { x: Number(click[1]), y: Number(click[2]) });
    const typed = phrase.match(/^type\s+(.+)$/i);
    if (typed) return execute('computer_write', { text: typed[1] });
    const scroll = phrase.match(/^scroll\s+(up|down)(?:\s+(\d+))?$/i);
    if (scroll) return execute('computer_scroll', { ticks: (scroll[1].toLowerCase() === 'up' ? 1 : -1) * Math.min(Number(scroll[2] ?? 3), 10) });
    const key = phrase.match(/^press\s+(.+)$/i);
    if (key) return execute('computer_key', { key: key[1].toLowerCase().replace(/\s+/g, '_') });
    const opened = phrase.match(/^open\s+(notepad|calculator|files|browser|settings)$/i);
    if (opened) return execute('computer_open', { application: opened[1].toLowerCase() });
    if (isScreenObservationCommand(phrase)) return execute('computer_observe', {}, phrase);
    if (isVisualScreenCommand(phrase)) return execute('computer_read_screen', { question: `Describe the visible screen and transcribe relevant text.${languageContext.getStore() ? ` Reply in language ${languageContext.getStore()}.` : ''}` });
    if (/^(capture|take) (?:a )?screenshot$/i.test(phrase)) return execute('computer_screenshot', {});
    const offerMissingAbility = async (output: string) => {
      if (!deps.capabilityWorkflow || !/(?:cannot|can't|unable|unsupported|not available|missing (?:tool|capability|ability)|don't have)/i.test(output)) return null;
      if (/(?:model|provider|rate limit|authentication|api key|permission|disabled|offline|timeout)/i.test(output)) return null;
      const workflow = await deps.capabilityWorkflow.assessAndMaybeRequest(phrase).catch(() => null);
      if (!workflow) return null;
      return respond(`${workflow.capability_name} is not available yet. I have saved your original task and asked for your approval to add this ability. Review the Approvals screen.`, false);
    };
    if (!isComputerIntent(phrase)) {
      if (busy || conversing) return { ok: false, response: 'TJ is finishing the previous turn.' };
      const answer = await converse(phrase);
      return await offerMissingAbility(answer.response) ?? answer;
    }
    if (conversing) return { ok: false, response: 'TJ is finishing the previous turn.' };
    if (busy) return respond('I am still working on your previous command.', true);
    busy = true;
    try {
      let operator = deps.agents.list().find((agent) => agent.template_id === 'computer_operator');
      if (!operator) operator = deps.agents.create({ workspace_id: 'default', template_id: 'computer_operator' });
      if (!voiceUsesDefaultModel()) {
        const freeToolModels = deps.router.candidates({ task_type: 'chat', needs_tools: true, max_cost_class: 'free' });
        const freeToolModel = freeToolModels.find((item) => item.id === 'openrouter/nvidia/nemotron-3-super-120b-a12b:free') ?? freeToolModels[0];
        if (!freeToolModel) return respond('No free tool-capable model is available for computer tasks.', true);
        if (operator.model_id !== freeToolModel.id) operator = deps.agents.update(operator.id, { model_id: freeToolModel.id });
      }
      const defaultModel = voiceUsesDefaultModel() ? deps.settings.get<string | null>('default_model_id', null) : null;
      if (voiceUsesDefaultModel() && !defaultModel) return respond('Choose a default model in Models for computer tasks.', true);
      const operatingAgent = defaultModel ? { ...operator, model_id: defaultModel } : operator;
      const language = languageContext.getStore();
      const context = [personaInstruction(getPersona(deps.settings)), language ? `The user spoke in language code ${language}. Reply in that same language and writing system.` : '',
        ...history.slice(-6).map((turn) => `User: ${turn.user}\nTJ: ${turn.assistant}`)].filter(Boolean).join('\n\n');
      const result = await deps.runtime.run({ agent: operatingAgent, instruction: phrase, context, workspace_id: 'default', project_id: null, project_root: null, task_id: null, max_steps: 8 });
      const output = result.output || result.error || 'No response';
      history.push({ user: phrase, assistant: output }); if (history.length > 12) history.shift();
      if (!result.ok) {
        const offer = await offerMissingAbility(output);
        if (offer) return offer;
      }
      return respond(output, !result.ok, true);
    } catch (error) { return respond(error instanceof Error ? error.message : String(error), true); }
    finally { busy = false; }
  };

  const listener = new VoiceListener(deps.bus, async (heard) => {
    if (WAKE.test(heard)) {
      deps.bus.emit({ name: 'voice.transcript', summary: heard });
      await languageContext.run('en', () => command(heard));
    }
  });
  const fishListener = new FishHandsFreeListener((wav) => fish.transcribe(wav), 'fish-audio', deps.bus, async (heard, language) => {
    await languageContext.run(language, () => command(heard));
  });
  const localListener = new FishHandsFreeListener((wav) => localASR.transcribe(wav), 'local-whisper', deps.bus, async (heard, language) => {
    await languageContext.run(language, () => command(heard));
  });
  deps.health.setMicrophoneStatusProvider(() => {
    const status = browserVoiceActive ? { available: true, listening: true, speaking: browserSpeaking, starting: false, transcribing: false, culture: 'auto', engine: 'browser-full-duplex', microphone: 'Browser microphone', last_transcription_ms: null, error: null } : currentListener().status();
    return !status.available ? 'unknown' : status.listening ? 'on' : 'off';
  });
  const startCurrent = async () => {
    if (handsfreeMode()) {
      if (listener.status().listening) listener.stop();
      if (asrProvider() === 'fish') { if (localListener.status().listening) localListener.stop(); return await fishListener.start(); }
      if (fishListener.status().listening) fishListener.stop();
      await localASR.start();
      return await localListener.start();
    }
    if (fishListener.status().listening) fishListener.stop();
    if (localListener.status().listening) localListener.stop();
    return listener.start();
  };
  const unsubscribeApproval = deps.bus.on('approval.requested', (event) => {
    const id = String(event.data.approval_id ?? '');
    const highRisk = event.data.risk === 'high' || event.data.risk === 'critical';
    const code = highRisk ? '' : String(randomInt(10, 100));
    if (id && code) approvalCodes.set(id, code);
    if (voiceSessionActive()) void speak(highRisk
      ? `Approval needed: ${event.summary}. Decide in the Approvals screen.`
      : `Approval needed: ${event.summary}. Say the wake word, approve ${code}. To deny, say the wake word, deny.`);
  });
  const unsubscribeSettings = deps.bus.on('system.settings_changed', () => {
    if (localASR.status().model && localASR.status().model !== (deps.settings.get<'fast' | 'accurate'>('voice_recognition_mode', 'fast') === 'accurate' ? 'base' : 'tiny')) {
      localListener.stop(); localASR.stop();
    }
    if (!voiceAvailable()) stopListening();
    else if (deps.settings.get<boolean>('voice_autostart', false)) void startCurrent().catch((error) => deps.bus.emit({ name: 'voice.error', severity: 'error', summary: String(error) }));
  });
  app.addHook('onClose', async () => { unsubscribeApproval(); unsubscribeSettings(); stopListening(); localASR.stop(); });
  if (voiceAvailable() && deps.settings.get<boolean>('voice_autostart', false)) {
    void startCurrent().catch((error) => deps.bus.emit({ name: 'voice.error', severity: 'error', summary: String(error) }));
  }

  app.get('/api/v1/computer/status', async () => {
    const bridge = computerAvailable() ? await runComputerBridge({ action: 'status' }) : { ok: false, error: 'Windows bridge unavailable' };
    return { available: bridge.ok === true, enabled: enabled(), bridge, voice: browserVoiceActive ? { available: true, listening: true, speaking: browserSpeaking, starting: false, transcribing: false, culture: 'auto', engine: 'browser-full-duplex', microphone: 'Browser microphone', last_transcription_ms: null, error: null } : currentListener().status(), local_asr: localASR.status() };
  });
  app.get('/api/v1/voice/status', async () => browserVoiceActive ? { available: true, listening: true, speaking: browserSpeaking, starting: false, transcribing: false, culture: 'auto', engine: 'browser-full-duplex', microphone: 'Browser microphone', last_transcription_ms: null, error: null } : currentListener().status());
  app.post('/api/v1/voice/interrupt', async () => {
    browserTurnGate.invalidate();
    speechGeneration++;
    activeConversation?.abort();
    activeSpeech?.abort();
    const listenerNow = currentListener();
    if (listenerNow instanceof FishHandsFreeListener) listenerNow.resume();
    return { ok: true, interrupted: true, voice: browserVoiceActive ? { available: true, listening: true, speaking: false, starting: false, transcribing: false, culture: 'auto', engine: 'browser-full-duplex', microphone: 'Browser microphone', last_transcription_ms: null, error: null } : listenerNow.status() };
  });
  app.post('/api/v1/voice/browser/start', async (request, reply) => {
    try {
      const parsed = z.object({ provider: z.enum(['local', 'fish']).optional() }).strict().safeParse(request.body ?? {});
      if (!parsed.success) return reply.status(400).send({ error: 'Choose a supported voice transcription provider.' });
      const selectedProvider = parsed.data.provider ?? asrProvider();
      stopListening();
      if (selectedProvider === 'fish') {
        if (!fish.configured()) return reply.status(503).send({ error: 'Configure Fish Audio transcription before starting browser voice.' });
      } else {
        if (!localASR.available()) return reply.status(503).send({ error: 'Install the local multilingual Whisper model before starting browser voice.' });
        await localASR.start();
      }
      browserASRProvider = selectedProvider;
      browserVoiceActive = true;
      return { available: true, listening: true, speaking: false, starting: false, transcribing: false, culture: 'auto', engine: 'browser-full-duplex', microphone: 'Browser microphone', last_transcription_ms: null, error: null };
    } catch (error) { return reply.status(503).send({ error: error instanceof Error ? error.message : 'Browser voice could not start.' }); }
  });
  app.post('/api/v1/voice/browser/state', async (request, reply) => {
    const parsed = z.object({ speaking: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success || !browserVoiceActive) return reply.status(400).send({ error: 'Browser voice session is not active.' });
    browserSpeaking = parsed.data.speaking;
    return { ok: true };
  });
  app.post('/api/v1/voice/browser/turn', async (request, reply) => {
    if (!browserVoiceActive) return reply.status(409).send({ error: 'Start a voice conversation before sending audio.' });
    const parsed = z.object({ wav_base64: z.string().min(100).max(12_000_000) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'A valid microphone audio clip is required.' });
    const turnGeneration = browserTurnGate.begin();
    try {
      const wav = Buffer.from(parsed.data.wav_base64, 'base64');
      if (wav.length < 1_000 || wav.length > 8_000_000 || wav.toString('ascii', 0, 4) !== 'RIFF') return reply.status(400).send({ error: 'Audio clip must be a bounded WAV recording.' });
      const turnStartedAt = Date.now();
      const usingFish = (browserASRProvider ?? asrProvider()) === 'fish';
      const result = usingFish ? await fish.transcribe(wav) : await localASR.transcribe(wav);
      const duration = Date.now() - turnStartedAt;
      if (!browserTurnGate.isCurrent(turnGeneration) || !browserVoiceActive) return { ok: true, ignored: true, interrupted: true, transcription_ms: duration };
      if (!result.text) return { ok: true, ignored: true, transcription_ms: duration };
      deps.bus.emit({ name: 'voice.transcript', summary: result.text, data: { language_code: result.language_code, engine: usingFish ? 'fish-audio' : 'local-whisper', transcription_ms: duration } });
      const response = await languageContext.run(result.language_code, () => command(result.text));
      if (!browserTurnGate.isCurrent(turnGeneration) || !browserVoiceActive) return { ok: true, ignored: true, interrupted: true, transcription_ms: duration };
      return { ...response, transcription_ms: duration, turn_ms: Date.now() - turnStartedAt };
    } catch (error) { return reply.status(502).send({ error: error instanceof Error ? error.message : 'Microphone transcription failed.' }); }
  });
  app.post('/api/v1/voice/browser/synthesize', async (request, reply) => {
    if (!browserVoiceActive) return reply.status(409).send({ error: 'Start a voice conversation before requesting speech.' });
    const parsed = z.object({ text: z.string().trim().min(1).max(400), voice_id: z.string().trim().min(1).max(160).optional() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Enter a short speech segment.' });
    const selected = parsed.data.voice_id ?? getPersona(deps.settings).voice_id;
    if (!selected?.startsWith('fish:')) return { type: 'browser-speech', voice_id: selected ?? 'windows:default' };
    const synthesisController = new AbortController();
    const abortSynthesis = () => synthesisController.abort();
    request.raw.once('aborted', abortSynthesis);
    reply.raw.once('close', () => { if (!reply.raw.writableEnded) abortSynthesis(); });
    try {
      const audio = await fish.synthesize(parsed.data.text, selected.slice(5), synthesisController.signal);
      return reply.type('audio/mpeg').header('cache-control', 'no-store').send(audio);
    } catch (error) {
      if (synthesisController.signal.aborted) return reply;
      return reply.status(502).send({ error: error instanceof Error ? error.message : 'Fish Audio speech generation failed.' });
    } finally { request.raw.off('aborted', abortSynthesis); }
  });
  app.get('/api/v1/voice/windows/voices', async () => {
    try {
      const voices = await listLocalVoices();
      return { voices: Array.isArray(voices) ? voices : [] };
    } catch {
      return { voices: [] };
    }
  });
  app.post('/api/v1/voice/windows/preview', async (request, reply) => {
    const parsed = z.object({ voice_id: z.string().max(120), text: z.string().trim().min(1).max(400) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Choose a voice and preview text.' });
    const voiceId = parsed.data.voice_id || 'neural:jenny';
    if (voiceId.startsWith('neural:')) return { ok: true, natural: true };
    if (!voiceId.startsWith('windows:')) return reply.status(400).send({ error: 'Choose a Windows voice.' });
    try {
      const name = voiceId.slice(8);
      const list = await listLocalVoices();
      if (!['default', 'female'].includes(name) && !list.some((voice) => voice.name === name)) {
        return reply.status(404).send({ error: 'That Windows voice is not installed.' });
      }
      await speak(parsed.data.text, voiceId);
      return { ok: true };
    } catch (error) { return reply.status(502).send({ error: error instanceof Error ? error.message : 'Windows voice preview failed.' }); }
  });
  app.get('/api/v1/voice/welcome', async (request) => {
    const locale = z.object({ locale: z.string().max(35).optional() }).parse(request.query).locale ?? 'en-US';
    return { text: welcomeText(locale), played: welcomePlayed(), voice_hint: welcomeVoice() };
  });
  app.post('/api/v1/voice/welcome', async (request, reply) => {
    const parsed = z.object({ locale: z.string().max(35).optional(), replay: z.boolean().optional() }).strict().safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid welcome request.' });
    const text = welcomeText(parsed.data.locale ?? 'en-US');
    const selectedVoice = welcomeVoice();
    deps.settings.set('welcome_voice_id', selectedVoice);
    deps.settings.set('welcome_greeting_version', 2);
    // Return speech data immediately for seamless client-side human neural playback
    return { played: true, text, speak_in_browser: true, voice_hint: selectedVoice };
  });
  app.post('/api/v1/voice/start', async (_request, reply) => {
    if (!voiceAvailable()) return reply.status(403).send({ error: 'Windows voice listening is unavailable on this host.' });
    try { const state = await startCurrent(); deps.settings.set('voice_autostart', true); return state; }
    catch (error) { return reply.status(500).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.post('/api/v1/voice/stop', async () => {
    deps.settings.set('voice_autostart', false);
    speechGeneration++; activeConversation?.abort(); activeSpeech?.abort();
    browserVoiceActive = false; browserSpeaking = false; browserASRProvider = null; stopListening(); localASR.stop();
    return currentListener().status();
  });
  app.post('/api/v1/voice/command', async (request) => command(commandSchema.parse(request.body).text));

  app.get('/api/v1/voice/live/config', async () => {
    let apiKey: string | null = null;
    const ref = deps.settings.get<string | null>('gemini_live_key_ref', null);
    if (ref) {
      try {
        apiKey = deps.vault.get(ref, 'voice', 'gemini-live');
      } catch {}
    }
    if (!apiKey) {
      apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
    }
    const voice = deps.settings.get<string>('gemini_live_voice', 'Puck');
    return {
      configured: Boolean(apiKey),
      api_key: apiKey,
      voice,
    };
  });

  app.put('/api/v1/voice/live/config', async (request, reply) => {
    const parsed = z.object({
      api_key: z.string().trim().min(10).nullable().optional(),
      voice: z.string().trim().min(1).max(50).optional(),
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid configuration data' });

    if (parsed.data.api_key === null) {
      deps.settings.set('gemini_live_key_ref', null);
    } else if (parsed.data.api_key) {
      const existingRef = deps.settings.get<string | null>('gemini_live_key_ref', null) ?? undefined;
      const ref = deps.vault.put({
        label: 'Gemini Live API Key',
        scope: 'voice:gemini-live',
        value: parsed.data.api_key,
        ref: existingRef,
      });
      deps.settings.set('gemini_live_key_ref', ref);
    }
    if (parsed.data.voice) {
      deps.settings.set('gemini_live_voice', parsed.data.voice);
    }
    const ref = deps.settings.get<string | null>('gemini_live_key_ref', null);
    const configured = Boolean(ref || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    return {
      ok: true,
      configured,
      voice: deps.settings.get<string>('gemini_live_voice', 'Puck'),
    };
  });

  app.get('/api/v1/voice/live/voice-preferences', async () => {
    const personaVoice = getPersona(deps.settings).voice_id;
    const modelId = deps.settings.get<string | null>('default_model_id', null) ?? 'default';
    const modelVoices = deps.settings.get<Record<string, string>>('live_voice_model_voices', {});
    return {
      chatgpt: modelVoices[modelId] ?? 'neural:jenny',
      fish: deps.settings.get<string | null>('live_voice_fish_voice', personaVoice?.startsWith('fish:') ? personaVoice : null),
    };
  });

  app.put('/api/v1/voice/live/voice-preferences', async (request, reply) => {
    const parsed = z.object({ provider: z.enum(['chatgpt', 'fish']), voice_id: z.string().trim().min(1).max(160) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Choose a valid voice for this provider.' });
    const validPrefix = parsed.data.provider === 'fish'
      ? parsed.data.voice_id.startsWith('fish:')
      : /^(fish:|neural:|windows:)/.test(parsed.data.voice_id);
    if (!validPrefix) return reply.status(400).send({ error: 'That voice is not supported for this provider.' });
    if (parsed.data.provider === 'fish') {
      deps.settings.set('live_voice_fish_voice', parsed.data.voice_id);
    } else {
      const modelId = deps.settings.get<string | null>('default_model_id', null) ?? 'default';
      const modelVoices = deps.settings.get<Record<string, string>>('live_voice_model_voices', {});
      deps.settings.set('live_voice_model_voices', { ...modelVoices, [modelId]: parsed.data.voice_id });
    }
    return { ok: true, provider: parsed.data.provider, voice_id: parsed.data.voice_id };
  });

  app.get('/api/v1/voice/fish/config', async () => ({ configured: fish.configured(), handsfree: handsfreeMode(), transcription: asrProvider() }));
  app.put('/api/v1/voice/fish/config', async (request, reply) => {
    const parsed = z.object({ api_key: z.string().min(20) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Enter a Fish Audio API key.' });
    try {
      const voices = await fish.configure(parsed.data.api_key);
      deps.settings.set('voice_handsfree_mode', localASR.available());
      deps.settings.set('voice_asr_provider', localASR.available() ? 'local' : 'fish');
      return { ok: true, configured: true, voices };
    } catch (error) { return reply.status(502).send({ error: error instanceof Error ? error.message : 'Fish Audio connection failed' }); }
  });
  app.get('/api/v1/voice/fish/voices', async (_request, reply) => {
    if (!fish.configured()) return { voices: [] };
    try { return { voices: await fish.voices() }; }
    catch (error) { return reply.status(502).send({ error: error instanceof Error ? error.message : 'Could not load Fish Audio voices' }); }
  });
  app.post('/api/v1/voice/fish/preview', async (request, reply) => {
    const parsed = z.object({ voice_id: z.string().min(1).max(120), text: z.string().min(1).max(400) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Choose a voice and preview text.' });
    try {
      const owned = await fish.voices();
      if (!owned.some((voice) => voice.id === parsed.data.voice_id)) return reply.status(404).send({ error: 'Voice is not in your Fish Audio library.' });
      await speak(parsed.data.text, `fish:${parsed.data.voice_id}`);
      return { ok: true };
    } catch (error) { return reply.status(502).send({ error: error instanceof Error ? error.message : 'Fish Audio preview failed' }); }
  });
}
