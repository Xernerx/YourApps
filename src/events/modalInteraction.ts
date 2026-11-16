/** @format */

import { EventBuilder } from '@xernerx/framework';
import { ContainerBuilder, MessageFlags, TextDisplayBuilder, type ModalSubmitInteraction } from 'discord.js';
import { buildStepContinueV2, extractModalAnswers, finalizeSubmission, MODAL_PAGE_SIZE, saveDraftAnswersMap, validateQuestionSlice } from '../lib/applicationFlow.js';
import { resolveUserAccent } from '../lib/guildSync.js';
import { processReviewDecision } from '../lib/reviewFlow.js';

export default class ModalInteractionEvent extends EventBuilder {
	constructor() {
		super('modalInteraction', {
			name: 'modalInteraction',
			emitter: 'client',
			once: false,
		});
	}

	override async run(interaction: ModalSubmitInteraction) {
		if (!interaction.customId.startsWith('ya:') || !interaction.guild) return;
		const ws = (this.client as any).websocket;
		const parts = interaction.customId.split(':');

		// 1. Sequential Application Modal Step: ya:modal:step:<posId>:<pageIdx>:<init|chain>
		if (parts[1] === 'modal' && (parts[2] === 'step' || parts[2] === 'fast' || parts[2] === 'page') && parts[3]) {
			const posId = parts[3];
			const pageIdx = parts[2] === 'fast' ? 0 : Math.max(0, Number(parts[4]) || 0);
			const isChain = parts[5] === 'chain' && interaction.isFromMessage();

			if (isChain) {
				await interaction.deferUpdate();
			} else {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			}

			const [accent, position, draft] = await Promise.all([
				resolveUserAccent(ws, interaction.user.id),
				ws.get('yourapps', 'forms', { id: posId, guild: interaction.guild.id }).catch(() => null),
				ws.get('yourapps', 'drafts', { guild: interaction.guild.id, userId: interaction.user.id, positionId: posId }).catch(() => null),
			]);

			if (!position) {
				const missing = new ContainerBuilder().setAccentColor(0xef4444).addTextDisplayComponents(new TextDisplayBuilder().setContent('Position no longer exists.'));
				await interaction.util.reply({ components: [missing], display: true });
				return;
			}

			const questions: any[] = Array.isArray(position.questions) ? position.questions : [];
			const totalPages = Math.max(1, Math.ceil(questions.length / MODAL_PAGE_SIZE));

			const answersMap = new Map<string, string>();
			if (Array.isArray(draft?.answers)) {
				for (const a of draft.answers) {
					if (a?.questionId) answersMap.set(String(a.questionId), String(a.answer ?? ''));
				}
			}

			const startIdx = pageIdx * MODAL_PAGE_SIZE;
			const pageQuestions = questions.slice(startIdx, startIdx + MODAL_PAGE_SIZE);
			extractModalAnswers(interaction, pageQuestions, answersMap);

			// Validate current step before advancing to next step
			const stepError = validateQuestionSlice(pageQuestions, startIdx, answersMap);
			if (stepError) {
				await saveDraftAnswersMap(ws, interaction.guild.id, interaction.user.id, position, answersMap, pageIdx).catch(() => null);
				const retryCard = buildStepContinueV2({
					position,
					nextPageIndex: pageIdx,
					accent,
					notice: stepError,
					isRetry: true,
				});
				await interaction.util.reply({ components: [retryCard], display: true });
				return;
			}

			// If more modal steps remain, save draft and present the 1-click Continue button
			if (pageIdx + 1 < totalPages) {
				const nextStep = pageIdx + 1;
				await saveDraftAnswersMap(ws, interaction.guild.id, interaction.user.id, position, answersMap, nextStep);
				const continueCard = buildStepContinueV2({
					position,
					nextPageIndex: nextStep,
					accent,
				});
				await interaction.util.reply({ components: [continueCard], display: true });
				return;
			}

			// Final step completed -> auto-submit immediately!
			await finalizeSubmission(interaction, ws, position, answersMap);
			return;
		}

		// 2. Review Reason Modal: ya:rev:modal:<decision>:<subId>
		if (parts[1] === 'rev' && parts[2] === 'modal' && parts[3] && parts[4]) {
			const decision = parts[3] === 'approved' ? 'approved' : 'denied';
			const subId = parts[4];
			const reason = interaction.fields.getTextInputValue('reason').trim() || null;
			await processReviewDecision(interaction, ws, subId, decision, reason);
		}
	}
}
