/** @format */

import { EventBuilder } from '@xernerx/framework';
import { MessageFlags, type ButtonInteraction, type GuildMember } from 'discord.js';
import { beginApplicationInteraction, openDraftModalPage } from '../lib/applicationFlow.js';
import { extractItems, getGuildConfig, resolveUserAccent } from '../lib/guildSync.js';
import { isGuildReviewer } from '../lib/permissions.js';
import { buildPositionsListV2 } from '../lib/positionsView.js';
import { buildReviewQueueV2, buildReviewReasonModal, buildSubmissionReviewV2, processReviewDecision } from '../lib/reviewFlow.js';
import { buildSubmissionInspectV2, buildSubmissionsListV2 } from '../lib/submissionsView.js';

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

		// 4. Submissions V2 buttons: ya:sub:view:<subId>:<page>:<scopeUserId>:<status> | ya:sub:page:<page>:<scopeUserId>:<status>
		if (parts[1] === 'sub') {
			const op = parts[2];
			const member = (interaction.member as GuildMember)?.roles ? (interaction.member as GuildMember) : await interaction.guild.members.fetch(interaction.user.id);
			const guildConfig = await getGuildConfig(ws, interaction.guild.id);
			const reviewer = isGuildReviewer(member, guildConfig);

			if (op === 'view' && parts[3]) {
				const subId = parts[3];
				const returnPage = Math.max(0, Number(parts[4]) || 0);
				const scopeUserId = parts[5] || 'all';
				const statusFilter = parts[6] || 'all';

				const [accent, sub] = await Promise.all([resolveUserAccent(ws, interaction.user.id), ws.get('yourapps', 'submissions', { id: subId, guild: interaction.guild.id }).catch(() => null)]);

				if (!sub) {
					await interaction.util.reply({ content: 'Submission not found.', ephemeral: true });
					return;
				}

				if (!reviewer && String(sub.userId) !== interaction.user.id) {
					await interaction.util.reply({ content: 'You can only view your own submissions.', ephemeral: true });
					return;
				}

				const container = buildSubmissionInspectV2({
					guildId: interaction.guild.id,
					submission: sub,
					accent,
					canReview: reviewer,
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

				const query: Record<string, any> = { guild: interaction.guild.id, limit: 100 };
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

		// 5. Review V2 & Log Card buttons: ya:rev:<op>:...
		if (parts[1] === 'rev') {
			const op = parts[2];

			if (op === 'inspect' && parts[3]) {
				const subId = parts[3];
				const returnPage = Math.max(0, Number(parts[4]) || 0);
				const filterPosId = parts[5] || 'all';

				const member = (interaction.member as GuildMember)?.roles ? (interaction.member as GuildMember) : await interaction.guild.members.fetch(interaction.user.id);
				const guildConfig = await getGuildConfig(ws, interaction.guild.id);
				if (!isGuildReviewer(member, guildConfig)) {
					await interaction.util.reply({ content: 'Reviewer permission required.', ephemeral: true });
					return;
				}

				const [accent, sub] = await Promise.all([resolveUserAccent(ws, interaction.user.id), ws.get('yourapps', 'submissions', { id: subId, guild: interaction.guild.id }).catch(() => null)]);
				if (!sub) {
					await interaction.util.reply({ content: 'Submission not found.', ephemeral: true });
					return;
				}

				const container = buildSubmissionReviewV2({ guildId: interaction.guild.id, submission: sub, accent, returnPage, filterPosId });
				await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
				return;
			}

			if (op === 'queue') {
				const page = Math.max(0, Number(parts[3]) || 0);
				const filterPosId = parts[4] || 'all';

				const member = (interaction.member as GuildMember)?.roles ? (interaction.member as GuildMember) : await interaction.guild.members.fetch(interaction.user.id);
				const guildConfig = await getGuildConfig(ws, interaction.guild.id);
				if (!isGuildReviewer(member, guildConfig)) {
					await interaction.util.reply({ content: 'Reviewer permission required.', ephemeral: true });
					return;
				}

				const [accent, res] = await Promise.all([
					resolveUserAccent(ws, interaction.user.id),
					ws.get('yourapps', 'submissions', { guild: interaction.guild.id, status: 'pending', limit: 100 }).catch(() => null),
				]);
				const container = buildReviewQueueV2({
					guildId: interaction.guild.id,
					guildName: interaction.guild.name,
					guildIconUrl: interaction.guild.iconURL({ extension: 'png', size: 256 }),
					pendingSubmissions: extractItems(res),
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
		}
	}
}
