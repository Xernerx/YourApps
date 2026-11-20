/** @format */

import { EventBuilder } from '@xernerx/framework';
import { Terminal } from '@xernerx/terminal';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { beginApplicationInteraction, openDraftModalPage } from '../lib/applicationFlow.js';
import { extractItems, getGuildConfig, resolveUserAccent } from '../lib/guildSync.js';
import { isAnyPositionReviewer, isPositionReviewer, resolveInteractionMember } from '../lib/permissions.js';
import { buildPositionsListV2 } from '../lib/positionsView.js';
import {
	buildApplicantClarifyModal,
	buildAskApplicantModal,
	buildReviewQueueV2,
	buildReviewReasonModal,
	buildStaffNoteModal,
	buildSubmissionReviewV2,
	handleApplicantWithdraw,
	handleCloseInterview,
	handleOpenInterview,
	handleReviewerVote,
	processReviewDecision,
} from '../lib/reviewFlow.js';
import { buildSubmissionInspectV2, buildSubmissionsListV2 } from '../lib/submissionsView.js';

const buttonLogger = new Terminal({ scope: 'BUTTON', spin: false });

export default class ButtonInteractionEvent extends EventBuilder {
	constructor() {
		super('buttonInteraction', {
			name: 'buttonInteraction',
			emitter: 'client',
			once: false,
		});
	}

	override async run(interaction: ButtonInteraction) {
		if (!interaction.customId.startsWith('ya:') || !interaction.guild) return;
		const ws = (this.client as any).websocket;
		const parts = interaction.customId.split(':');

		try {
			// 1. Apply Panel / Positions inline button: ya:apply:start:<posId>
			if (parts[1] === 'apply' && parts[2] === 'start' && parts[3]) {
				await beginApplicationInteraction(interaction, ws, parts[3]);
				return;
			}

			// 2. Positions V2 navigation buttons: ya:pos:page:<page>
			if (parts[1] === 'pos' && parts[2] === 'page') {
				const page = Math.max(0, Number(parts[3]) || 0);
				const [accent, res] = await Promise.all([resolveUserAccent(ws, interaction.user.id), ws.get('yourapps', 'forms', { guild: interaction.guild.id }).catch(() => null)]);
				const positions = extractItems(res);
				const container = buildPositionsListV2({
					guildId: interaction.guild.id,
					guildName: interaction.guild.name,
					guildIconUrl: interaction.guild.iconURL({ extension: 'png', size: 256 }),
					positions,
					accent,
					page,
				});
				await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
				return;
			}

			// 3. Sequential Modal Step Continue / Retry button: ya:draft:next:<posId>:<pageIdx>
			if (parts[1] === 'draft' && (parts[2] === 'next' || parts[2] === 'openmodal') && parts[3]) {
				const posId = parts[3];
				const pageIndex = Math.max(0, Number(parts[4]) || 0);
				await openDraftModalPage(interaction, ws, posId, pageIndex);
				return;
			}

			// 4. Submissions V2 & Applicant Self-Service buttons: ya:sub:*
			if (parts[1] === 'sub') {
				const op = parts[2];

				if (op === 'withdraw' && parts[3]) {
					await handleApplicantWithdraw(interaction, ws, parts[3]);
					return;
				}

				if (op === 'clarify' && parts[3]) {
					const sub = await ws.get('yourapps', 'submissions', { id: parts[3], guild: interaction.guild.id, viewerScope: 'applicant' }).catch(() => null);
					if (!sub || String(sub.userId) !== interaction.user.id) {
						await interaction.util.reply({ content: 'Only the applicant can respond to this clarification.', ephemeral: true });
						return;
					}
					const clarifications: any[] = Array.isArray(sub.clarifications) ? sub.clarifications : [];
					const latest = clarifications[clarifications.length - 1];
					await interaction.showModal(buildApplicantClarifyModal(parts[3], latest?.prompt ? String(latest.prompt) : undefined));
					return;
				}

				const [member, guildConfig, formsRes] = await Promise.all([
					resolveInteractionMember(interaction),
					getGuildConfig(ws, interaction.guild.id),
					ws.get('yourapps', 'forms', { guild: interaction.guild.id }).catch(() => null),
				]);
				const positions = extractItems(formsRes);
				const reviewer = isAnyPositionReviewer(member, guildConfig, positions, interaction.memberPermissions);

				if (op === 'view' && parts[3]) {
					const subId = parts[3];
					const returnPage = Math.max(0, Number(parts[4]) || 0);
					const scopeUserId = parts[5] || 'all';
					const statusFilter = parts[6] || 'all';

					const [accent, sub] = await Promise.all([
						resolveUserAccent(ws, interaction.user.id),
						ws.get('yourapps', 'submissions', { id: subId, guild: interaction.guild.id, ...(reviewer ? {} : { viewerScope: 'applicant' }) }).catch(() => null),
					]);

					if (!sub) {
						await interaction.util.reply({ content: 'Submission not found.', ephemeral: true });
						return;
					}

					const pos = positions.find((p: any) => String(p.id) === String(sub.positionId));
					const canReviewThis = isPositionReviewer(member, guildConfig, pos, interaction.memberPermissions);

					if (!canReviewThis && String(sub.userId) !== interaction.user.id) {
						await interaction.util.reply({ content: 'You can only view your own submissions.', ephemeral: true });
						return;
					}

					const container = buildSubmissionInspectV2({
						guildId: interaction.guild.id,
						submission: sub,
						accent,
						canReview: canReviewThis,
						viewerId: interaction.user.id,
						returnPage,
						scopeUserId,
						statusFilter,
					});
					await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
					return;
				}

				if (op === 'page') {
					const page = Math.max(0, Number(parts[3]) || 0);
					const scopeUserId = parts[4] || 'all';
					const statusFilter = parts[5] || 'all';

					if (scopeUserId !== 'all' && scopeUserId !== interaction.user.id && !reviewer) {
						await interaction.util.reply({ content: 'Reviewer permission required.', ephemeral: true });
						return;
					}
					if (scopeUserId === 'all' && !reviewer) {
						await interaction.util.reply({ content: 'Reviewer permission required.', ephemeral: true });
						return;
					}

					const query: Record<string, any> = { guild: interaction.guild.id, limit: 100, ...(reviewer ? {} : { viewerScope: 'applicant' }) };
					if (scopeUserId !== 'all') query.userId = scopeUserId;

					const [accent, res, targetUser] = await Promise.all([
						resolveUserAccent(ws, interaction.user.id),
						ws.get('yourapps', 'submissions', query).catch(() => null),
						scopeUserId !== 'all' ? interaction.client.users.fetch(scopeUserId).catch(() => null) : Promise.resolve(null),
					]);

					const container = buildSubmissionsListV2({
						guildId: interaction.guild.id,
						titleName: targetUser ? targetUser.username : interaction.guild.name,
						thumbnailUrl: targetUser ? targetUser.displayAvatarURL({ extension: 'png', size: 128 }) : interaction.guild.iconURL({ extension: 'png', size: 256 }),
						submissions: extractItems(res),
						accent,
						scopeUserId,
						canReview: reviewer,
						isSelfView: scopeUserId === interaction.user.id,
						page,
						statusFilter,
					});
					await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
					return;
				}
			}

			// 5. Review V2, Votes, Notes, Clarifications, Interviews & Log Card buttons: ya:rev:<op>:...
			if (parts[1] === 'rev') {
				const op = parts[2];

				if (op === 'vote' && (parts[3] === 'up' || parts[3] === 'down') && parts[4]) {
					await handleReviewerVote(interaction, ws, parts[4], parts[3]);
					return;
				}

				if (op === 'inspect' && parts[3]) {
					const subId = parts[3];
					const returnPage = Math.max(0, Number(parts[4]) || 0);
					const filterPosId = parts[5] || 'all';

					const [member, guildConfig, accent, sub] = await Promise.all([
						resolveInteractionMember(interaction),
						getGuildConfig(ws, interaction.guild.id),
						resolveUserAccent(ws, interaction.user.id),
						ws.get('yourapps', 'submissions', { id: subId, guild: interaction.guild.id }).catch(() => null),
					]);

					if (!sub) {
						await interaction.util.reply({ content: 'Submission not found.', ephemeral: true });
						return;
					}

					const pos = await ws.get('yourapps', 'forms', { id: sub.positionId, guild: interaction.guild.id }).catch(() => null);
					if (!isPositionReviewer(member, guildConfig, pos, interaction.memberPermissions)) {
						await interaction.util.reply({ content: 'Reviewer permission required for this position.', ephemeral: true });
						return;
					}

					const container = buildSubmissionReviewV2({ guildId: interaction.guild.id, submission: sub, accent, returnPage, filterPosId });
					await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
					return;
				}

				if (op === 'queue') {
					const page = Math.max(0, Number(parts[3]) || 0);
					const filterPosId = parts[4] || 'all';

					const [member, guildConfig, formsRes, accent, res] = await Promise.all([
						resolveInteractionMember(interaction),
						getGuildConfig(ws, interaction.guild.id),
						ws.get('yourapps', 'forms', { guild: interaction.guild.id }).catch(() => null),
						resolveUserAccent(ws, interaction.user.id),
						ws.get('yourapps', 'submissions', { guild: interaction.guild.id, status: 'reviewable', limit: 100 }).catch(() => null),
					]);

					const positions = extractItems(formsRes);
					if (!isAnyPositionReviewer(member, guildConfig, positions, interaction.memberPermissions)) {
						await interaction.util.reply({ content: 'Reviewer permission required.', ephemeral: true });
						return;
					}

					const posMap = new Map<string, any>();
					for (const p of positions) posMap.set(String(p.id), p);
					const allowedSubs = extractItems(res).filter((s: any) => isPositionReviewer(member, guildConfig, posMap.get(String(s.positionId)), interaction.memberPermissions));

					const container = buildReviewQueueV2({
						guildId: interaction.guild.id,
						guildName: interaction.guild.name,
						guildIconUrl: interaction.guild.iconURL({ extension: 'png', size: 256 }),
						pendingSubmissions: allowedSubs,
						accent,
						page,
						filterPosId,
					});
					await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
					return;
				}

				const subId = parts[3];
				if (!subId) return;

				if (op === 'approve') {
					await processReviewDecision(interaction, ws, subId, 'approved', null);
					return;
				}
				if (op === 'approve_note') {
					await interaction.showModal(buildReviewReasonModal('approved', subId));
					return;
				}
				if (op === 'deny') {
					await interaction.showModal(buildReviewReasonModal('denied', subId));
					return;
				}
				if (op === 'note') {
					await interaction.showModal(buildStaffNoteModal(subId));
					return;
				}
				if (op === 'ask') {
					await interaction.showModal(buildAskApplicantModal(subId));
					return;
				}
				if (op === 'interview') {
					await handleOpenInterview(interaction, ws, subId);
					return;
				}
				if (op === 'closeint') {
					await handleCloseInterview(interaction, ws, subId);
					return;
				}
			}
		} catch (err: any) {
			buttonLogger.error(`Button interaction ${interaction.customId} failed: ${err?.message || err}`);
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({ content: 'Something went wrong while opening that form. Please try again in a moment.', flags: MessageFlags.Ephemeral }).catch(() => null);
			}
		}
	}
}
