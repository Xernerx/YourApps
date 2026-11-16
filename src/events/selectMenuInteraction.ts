/** @format */

import { EventBuilder } from '@xernerx/framework';
import { MessageFlags, type AnySelectMenuInteraction, type GuildMember, type StringSelectMenuInteraction } from 'discord.js';
import { beginApplicationInteraction } from '../lib/applicationFlow.js';
import { extractItems, getGuildConfig, resolveUserAccent } from '../lib/guildSync.js';
import { isGuildReviewer } from '../lib/permissions.js';
import { buildPositionDetailV2 } from '../lib/positionsView.js';
import { buildReviewQueueV2 } from '../lib/reviewFlow.js';
import { buildSubmissionsListV2 } from '../lib/submissionsView.js';

export default class SelectMenuInteractionEvent extends EventBuilder {
	constructor() {
		super('selectMenuInteraction', {
			name: 'selectMenuInteraction',
			emitter: 'client',
			once: false,
		});
	}

	override async run(interaction: AnySelectMenuInteraction) {
		if (!interaction.customId.startsWith('ya:') || !interaction.guild) return;
		const ws = (this.client as any).websocket;
		const parts = interaction.customId.split(':');

		// 1. Multi-position Apply Panel dropdown: ya:apply:select
		if (interaction.customId === 'ya:apply:select' && interaction.isStringSelectMenu()) {
			const posId = interaction.values[0];
			if (posId) {
				await beginApplicationInteraction(interaction as StringSelectMenuInteraction, ws, posId);
			}
			return;
		}

		// 2. Positions V2 inspect dropdown: ya:pos:inspect:<returnPage>
		if (parts[1] === 'pos' && parts[2] === 'inspect' && interaction.isStringSelectMenu()) {
			const returnPage = Math.max(0, Number(parts[3]) || 0);
			const posId = interaction.values[0];
			if (!posId) return;

			const [accent, pos] = await Promise.all([resolveUserAccent(ws, interaction.user.id), ws.get('yourapps', 'forms', { id: posId, guild: interaction.guild.id }).catch(() => null)]);
			if (!pos) {
				await interaction.util.reply({ content: 'Position no longer exists.', ephemeral: true });
				return;
			}

			const container = buildPositionDetailV2({ guildId: interaction.guild.id, position: pos, accent, returnPage });
			await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
			return;
		}

		// 3. Submissions V2 status filter dropdown: ya:sub:status:<scopeUserId>
		if (parts[1] === 'sub' && parts[2] === 'status' && interaction.isStringSelectMenu()) {
			const scopeUserId = parts[3] || 'all';
			const statusFilter = interaction.values[0] || 'all';

			const member = (interaction.member as GuildMember)?.roles ? (interaction.member as GuildMember) : await interaction.guild.members.fetch(interaction.user.id);
			const guildConfig = await getGuildConfig(ws, interaction.guild.id);
			const reviewer = isGuildReviewer(member, guildConfig);

			if ((scopeUserId === 'all' || scopeUserId !== interaction.user.id) && !reviewer) {
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
				page: 0,
				statusFilter,
			});

			await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
			return;
		}

		// 4. Review V2 position filter dropdown: ya:rev:filterpos
		if (parts[1] === 'rev' && parts[2] === 'filterpos' && interaction.isStringSelectMenu()) {
			const member = (interaction.member as GuildMember)?.roles ? (interaction.member as GuildMember) : await interaction.guild.members.fetch(interaction.user.id);
			const guildConfig = await getGuildConfig(ws, interaction.guild.id);
			if (!isGuildReviewer(member, guildConfig)) {
				await interaction.util.reply({ content: 'Reviewer permission required.', ephemeral: true });
				return;
			}

			const filterPosId = interaction.values[0] || 'all';
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
				page: 0,
				filterPosId,
			});

			await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
		}
	}
}
