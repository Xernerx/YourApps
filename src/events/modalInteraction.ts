/** @format */

import { EventBuilder } from '@xernerx/framework';
import { Terminal } from '@xernerx/terminal';
import { ContainerBuilder, MessageFlags, TextDisplayBuilder, type ModalSubmitInteraction } from 'discord.js';
import { buildStepContinueV2, computeDynamicModalSteps, extractModalAnswers, finalizeSubmission, saveDraftAnswersMap, validateStepItems } from '../lib/applicationFlow.js';
import { resolveUserAccent } from '../lib/guildSync.js';
import { handleApplicantClarifySubmit, handleAskApplicantSubmit, handleStaffNoteSubmit, processReviewDecision } from '../lib/reviewFlow.js';

const modalLogger = new Terminal({ scope: 'MODAL', spin: false });

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

		try {
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
				const answersMap = new Map<string, string>();
				if (Array.isArray(draft?.answers)) {
					for (const a of draft.answers) {
						if (a?.questionId) answersMap.set(String(a.questionId), String(a.answer ?? ''));
					}
				}

				const stepsBefore = computeDynamicModalSteps(questions, answersMap);
				const currentStepItems = stepsBefore[pageIdx] || [];
				extractModalAnswers(interaction, currentStepItems, answersMap);

				const stepsAfter = computeDynamicModalSteps(questions, answersMap);
				const totalPagesAfter = Math.max(1, stepsAfter.length);

				const stepError = validateStepItems(currentStepItems, answersMap);
				if (stepError) {
					await saveDraftAnswersMap(ws, interaction.guild.id, interaction.user.id, position, answersMap, pageIdx).catch(() => null);
					const retryCard = buildStepContinueV2({
						position,
						nextPageIndex: pageIdx,
						totalPages: totalPagesAfter,
						accent,
						notice: stepError,
						isRetry: true,
					});
					await interaction.util.reply({ components: [retryCard], display: true });
					return;
				}

				if (pageIdx + 1 < totalPagesAfter) {
					const nextStep = pageIdx + 1;
					await saveDraftAnswersMap(ws, interaction.guild.id, interaction.user.id, position, answersMap, nextStep);
					const continueCard = buildStepContinueV2({
						position,
						nextPageIndex: nextStep,
						totalPages: totalPagesAfter,
						accent,
					});
					await interaction.util.reply({ components: [continueCard], display: true });
					return;
				}

				await finalizeSubmission(interaction, ws, position, answersMap);
				return;
			}

			// 2. Review Reason Modal: ya:rev:modal:<decision>:<subId>
			if (parts[1] === 'rev' && parts[2] === 'modal' && parts[3] && parts[4]) {
				const decision = parts[3] === 'approved' ? 'approved' : 'denied';
				const subId = parts[4];
				const reason = interaction.fields.getTextInputValue('reason').trim() || null;
				await processReviewDecision(interaction, ws, subId, decision, reason);
				return;
			}

			// 3. Internal Staff Note Modal: ya:rev:notemodal:<subId>
			if (parts[1] === 'rev' && parts[2] === 'notemodal' && parts[3]) {
				await handleStaffNoteSubmit(interaction, ws, parts[3]);
				return;
			}

			// 4. Ask Applicant Clarification Modal: ya:rev:askmodal:<subId>
			if (parts[1] === 'rev' && parts[2] === 'askmodal' && parts[3]) {
				await handleAskApplicantSubmit(interaction, ws, parts[3]);
				return;
			}

			// 5. Applicant Clarification Response Modal: ya:sub:clarifymodal:<subId>
			if (parts[1] === 'sub' && parts[2] === 'clarifymodal' && parts[3]) {
				await handleApplicantClarifySubmit(interaction, ws, parts[3]);
			}
		} catch (err: any) {
			modalLogger.error(`Modal interaction ${interaction.customId} failed: ${err?.message || err}`);
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({ content: 'Something went wrong while submitting your response. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => null);
			} else {
				await interaction.editReply({ content: 'Something went wrong while submitting your response. Please try again.' }).catch(() => null);
			}
		}
	}
}
