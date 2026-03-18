import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_PATH = resolve(__dirname, '../../models.json');
function defaultCodexReasoningEfforts() {
    return ['low', 'medium', 'high', 'xhigh'];
}
function normalizeCliConfig(raw, cli) {
    if (Array.isArray(raw)) {
        const models = raw.map((id) => ({
            id: String(id),
            ...(cli === 'codex' ? { reasoningEfforts: defaultCodexReasoningEfforts() } : {}),
        }));
        return {
            defaultModel: models[0]?.id ?? (cli === 'codex' ? 'gpt-5.4' : 'claude-sonnet-4-5'),
            ...(cli === 'codex' ? { defaultReasoningEffort: 'medium' } : {}),
            models,
        };
    }
    const obj = (raw ?? {});
    const rawModels = Array.isArray(obj.models) ? obj.models : [];
    const models = rawModels.map((entry) => {
        if (typeof entry === 'string') {
            return {
                id: entry,
                ...(cli === 'codex' ? { reasoningEfforts: defaultCodexReasoningEfforts() } : {}),
            };
        }
        const model = entry;
        const reasoningEfforts = Array.isArray(model.reasoningEfforts)
            ? model.reasoningEfforts.filter((value) => ['low', 'medium', 'high', 'xhigh'].includes(String(value)))
            : undefined;
        return {
            id: String(model.id ?? ''),
            ...(reasoningEfforts && reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
        };
    }).filter((model) => model.id);
    return {
        defaultModel: String(obj.defaultModel ?? models[0]?.id ?? (cli === 'codex' ? 'gpt-5.4' : 'claude-sonnet-4-5')),
        ...(cli === 'codex'
            ? {
                defaultReasoningEffort: (['low', 'medium', 'high', 'xhigh'].includes(String(obj.defaultReasoningEffort))
                    ? obj.defaultReasoningEffort
                    : 'medium'),
            }
            : {}),
        models,
    };
}
export function loadModelsConfig() {
    try {
        const raw = JSON.parse(readFileSync(MODELS_PATH, 'utf-8'));
        return {
            codex: normalizeCliConfig(raw.codex, 'codex'),
            'claude-code': normalizeCliConfig(raw['claude-code'], 'claude-code'),
        };
    }
    catch {
        return {
            codex: {
                defaultModel: 'gpt-5.4',
                defaultReasoningEffort: 'medium',
                models: [{ id: 'gpt-5.4', reasoningEfforts: defaultCodexReasoningEfforts() }],
            },
            'claude-code': {
                defaultModel: 'claude-sonnet-4-5',
                models: [{ id: 'claude-sonnet-4-5' }],
            },
        };
    }
}
export function getCodexModelOption(modelId) {
    return loadModelsConfig().codex.models.find((model) => model.id === modelId);
}
