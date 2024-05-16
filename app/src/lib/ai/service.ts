import { AnthropicAIClient } from '$lib/ai/anthropicClient';
import { ButlerAIClient } from '$lib/ai/butlerClient';
import {
	DEFAULT_OLLAMA_ENDPOINT,
	DEFAULT_OLLAMA_MODEL_NAME,
	OllamaClient
} from '$lib/ai/ollamaClient';
import { OpenAIClient } from '$lib/ai/openAIClient';
import {
	OpenAIModelName,
	type AIClient,
	AnthropicModelName,
	ModelKind,
	type PromptMessage,
	MessageRole
} from '$lib/ai/types';
import { splitMessage } from '$lib/utils/commitMessage';
import * as toasts from '$lib/utils/toasts';
import OpenAI from 'openai';
import type { GitConfigService } from '$lib/backend/gitConfigService';
import type { HttpClient } from '$lib/backend/httpClient';
import type { Hunk } from '$lib/vbranches/types';

const maxDiffLengthLimitForAPI = 5000;

export enum KeyOption {
	BringYourOwn = 'bringYourOwn',
	ButlerAPI = 'butlerAPI'
}

export enum GitAIConfigKey {
	ModelProvider = 'gitbutler.aiModelProvider',
	OpenAIKeyOption = 'gitbutler.aiOpenAIKeyOption',
	OpenAIModelName = 'gitbutler.aiOpenAIModelName',
	OpenAIKey = 'gitbutler.aiOpenAIKey',
	AnthropicKeyOption = 'gitbutler.aiAnthropicKeyOption',
	AnthropicModelName = 'gitbutler.aiAnthropicModelName',
	AnthropicKey = 'gitbutler.aiAnthropicKey',
	DiffLengthLimit = 'gitbutler.diffLengthLimit',
	OllamaEndpoint = 'gitbutler.aiOllamaEndpoint',
	OllamaModelName = 'gitbutler.aiOllamaModelName'
}

type SummarizeCommitOpts = {
	hunks: Hunk[];
	useEmojiStyle?: boolean;
	useBriefStyle?: boolean;
	commitTemplate?: PromptMessage[];
	userToken?: string;
};

type SummarizeBranchOpts = {
	hunks: Hunk[];
	branchTemplate?: PromptMessage[];
	userToken?: string;
};

// Exported for testing only
export function buildDiff(hunks: Hunk[], limit: number) {
	return shuffle(hunks.map((h) => `${h.filePath} - ${h.diff}`))
		.join('\n')
		.slice(0, limit);
}

function shuffle<T>(items: T[]): T[] {
	return items
		.map((item) => ({ item, value: Math.random() }))
		.sort(({ value: a }, { value: b }) => a - b)
		.map((item) => item.item);
}

export class AIService {
	constructor(
		private gitConfig: GitConfigService,
		private cloud: HttpClient
	) {}

	async getModelKind() {
		return await this.gitConfig.getWithDefault<ModelKind>(
			GitAIConfigKey.ModelProvider,
			ModelKind.OpenAI
		);
	}

	async getOpenAIKeyOption() {
		return await this.gitConfig.getWithDefault<KeyOption>(
			GitAIConfigKey.OpenAIKeyOption,
			KeyOption.ButlerAPI
		);
	}

	async getOpenAIKey() {
		return await this.gitConfig.get(GitAIConfigKey.OpenAIKey);
	}

	async getOpenAIModleName() {
		return await this.gitConfig.getWithDefault<OpenAIModelName>(
			GitAIConfigKey.OpenAIModelName,
			OpenAIModelName.GPT35Turbo
		);
	}

	async getAnthropicKeyOption() {
		return await this.gitConfig.getWithDefault<KeyOption>(
			GitAIConfigKey.AnthropicKeyOption,
			KeyOption.ButlerAPI
		);
	}

	async getAnthropicKey() {
		return await this.gitConfig.get(GitAIConfigKey.AnthropicKey);
	}

	async getAnthropicModelName() {
		return await this.gitConfig.getWithDefault<AnthropicModelName>(
			GitAIConfigKey.AnthropicModelName,
			AnthropicModelName.Haiku
		);
	}

	async getDiffLengthLimit() {
		const limitString = await this.gitConfig.getWithDefault<string>(
			GitAIConfigKey.DiffLengthLimit,
			'5000'
		);

		return parseInt(limitString, 10);
	}

	/**
	 * Returns the diff length limit with a specificed upper bound of characers in order to not inundate the API.
	 */
	async getDiffLengthLimitConsideringAPI() {
		const diffLengthLimit = await this.getDiffLengthLimit();

		if (await this.usingGitButlerAPI()) {
			return Math.max(maxDiffLengthLimitForAPI, diffLengthLimit);
		} else {
			return diffLengthLimit;
		}
	}

	async getOllamaEndpoint() {
		return await this.gitConfig.getWithDefault<string>(
			GitAIConfigKey.OllamaEndpoint,
			DEFAULT_OLLAMA_ENDPOINT
		);
	}

	async getOllamaModelName() {
		return await this.gitConfig.getWithDefault<string>(
			GitAIConfigKey.OllamaModelName,
			DEFAULT_OLLAMA_MODEL_NAME
		);
	}

	async usingGitButlerAPI() {
		const modelKind = await this.getModelKind();
		const openAIKeyOption = await this.getOpenAIKeyOption();
		const anthropicKeyOption = await this.getAnthropicKeyOption();

		const openAIActiveAndUsingButlerAPI =
			modelKind == ModelKind.OpenAI && openAIKeyOption == KeyOption.ButlerAPI;
		const anthropicActiveAndUsingButlerAPI =
			modelKind == ModelKind.Anthropic && anthropicKeyOption == KeyOption.ButlerAPI;

		return openAIActiveAndUsingButlerAPI || anthropicActiveAndUsingButlerAPI;
	}

	async validateConfiguration(userToken?: string): Promise<boolean> {
		const modelKind = await this.getModelKind();
		const openAIKey = await this.getOpenAIKey();
		const anthropicKey = await this.getAnthropicKey();
		const ollamaEndpoint = await this.getOllamaEndpoint();
		const ollamaModelName = await this.getOllamaModelName();

		if (await this.usingGitButlerAPI()) return !!userToken;

		const openAIActiveAndKeyProvided = modelKind == ModelKind.OpenAI && !!openAIKey;
		const anthropicActiveAndKeyProvided = modelKind == ModelKind.Anthropic && !!anthropicKey;
		const ollamaActiveAndEndpointProvided =
			modelKind == ModelKind.Ollama && !!ollamaEndpoint && !!ollamaModelName;

		return (
			openAIActiveAndKeyProvided || anthropicActiveAndKeyProvided || ollamaActiveAndEndpointProvided
		);
	}

	// This optionally returns a summarizer. There are a few conditions for how this may occur
	// Firstly, if the user has opted to use the GB API and isn't logged in, it will return undefined
	// Secondly, if the user has opted to bring their own key but hasn't provided one, it will return undefined
	async buildClient(userToken?: string): Promise<undefined | AIClient> {
		const modelKind = await this.getModelKind();

		if (await this.usingGitButlerAPI()) {
			if (!userToken) {
				toasts.error("When using GitButler's API to summarize code, you must be logged in");
				return;
			}
			return new ButlerAIClient(this.cloud, userToken, modelKind);
		}

		if (modelKind == ModelKind.Ollama) {
			const ollamaEndpoint = await this.getOllamaEndpoint();
			const ollamaModelName = await this.getOllamaModelName();
			return new OllamaClient(ollamaEndpoint, ollamaModelName);
		}

		if (modelKind == ModelKind.OpenAI) {
			const openAIModelName = await this.getOpenAIModleName();
			const openAIKey = await this.getOpenAIKey();

			if (!openAIKey) {
				toasts.error(
					'When using OpenAI in a bring your own key configuration, you must provide a valid token'
				);
				return;
			}

			const openAI = new OpenAI({ apiKey: openAIKey, dangerouslyAllowBrowser: true });
			return new OpenAIClient(openAIModelName, openAI);
		}

		if (modelKind == ModelKind.Anthropic) {
			const anthropicModelName = await this.getAnthropicModelName();
			const anthropicKey = await this.getAnthropicKey();

			if (!anthropicKey) {
				toasts.error(
					'When using Anthropic in a bring your own key configuration, you must provide a valid token'
				);
				return;
			}

			return new AnthropicAIClient(anthropicKey, anthropicModelName);
		}
	}

	async summarizeCommit({
		hunks,
		useEmojiStyle = false,
		useBriefStyle = false,
		commitTemplate,
		userToken
	}: SummarizeCommitOpts) {
		const aiClient = await this.buildClient(userToken);
		if (!aiClient) return;

		const diffLengthLimit = await this.getDiffLengthLimitConsideringAPI();
		const defaultedCommitTemplate = commitTemplate || aiClient.defaultCommitTemplate;

		const prompt = defaultedCommitTemplate.map((promptMessage) => {
			if (promptMessage.role != MessageRole.User) {
				return promptMessage;
			}

			let content = promptMessage.content.replaceAll('%{diff}', buildDiff(hunks, diffLengthLimit));

			const briefPart = useBriefStyle
				? 'The commit message must be only one sentence and as short as possible.'
				: '';
			content = content.replaceAll('%{brief_style}', briefPart);

			const emojiPart = useEmojiStyle
				? 'Make use of GitMoji in the title prefix.'
				: "Don't use any emoji.";
			content = content.replaceAll('%{emoji_style}', emojiPart);

			return {
				role: MessageRole.User,
				content
			};
		});

		let message = await aiClient.evaluate(prompt);

		if (useBriefStyle) {
			message = message.split('\n')[0];
		}

		const { title, description } = splitMessage(message);
		return description ? `${title}\n\n${description}` : title;
	}

	async summarizeBranch({ hunks, branchTemplate, userToken = undefined }: SummarizeBranchOpts) {
		const aiClient = await this.buildClient(userToken);
		if (!aiClient) return;

		const diffLengthLimit = await this.getDiffLengthLimitConsideringAPI();
		const defaultedBranchTemplate = branchTemplate || aiClient.defaultBranchTemplate;
		const prompt = defaultedBranchTemplate.map((promptMessage) => {
			if (promptMessage.role != MessageRole.User) {
				return promptMessage;
			}

			return {
				role: MessageRole.User,
				content: promptMessage.content.replaceAll('%{diff}', buildDiff(hunks, diffLengthLimit))
			};
		});

		const message = await aiClient.evaluate(prompt);
		return message.replaceAll(' ', '-').replaceAll('\n', '-');
	}
}
