/** @format */

import { SlashCommandBuilder, type SlashCommandAutocomplete, type SlashCommandOptions } from '@xernerx/framework';
import { ContainerBuilder, TextDisplayBuilder, type GuildMember } from 'discord.js';
import { extractItems, getGuildConfig, resolveUserAccent } from '../../lib/guildSync.js';
import { isGuildReviewer } from '../../lib/permissions.js';
import { buildReviewQueueV2, buildSubmissionReviewV2 } from '../../lib/reviewFlow.js';

export default class ReviewCommand extends SlashCommandBuilder {
	constructor() {
		super('review', {
			name: 'review',
			description: 'Browse and review pending applications directly inside Discord.',
			defer: false,
			permissions: {
				user: ['ManageGuild'],
			},
			options: [
				{
					type: 'string',
					name: 'submission',
					description: 'Jump directly to a specific submission ID.',
					required: false,
					autocomplete: true,
				},
			],
		});
	}

	override async autocomplete({ interaction, focused }: SlashCommandAutocomplete) {
		if (!interaction.guildId) {
			await (interaction as any).respond([]);
			return;
		}
		const ws = (this.client as any).websocket;
		const res = await ws.get('yourapps', 'submissions', { guild: interaction.guildId, status: 'pending', limit: 25 }).catch(() => null);
		const q = String(focused.value || '').toLowerCase();
		const subs = extractItems(res).filter(
			(s: any) =>
				!q ||
				String(s.id).toLowerCase().includes(q) ||
				String(s.userTag || '')
					.toLowerCase()
					.includes(q) ||
				String(s.positionName || '')
					.toLowerCase()
					.includes(q)
		);

		await (interaction as any).respond(
			subs.slice(0, 25).map((s: any) => ({
				name: `${s.userTag || s.userId} • ${s.positionName} (#${s.id})`.slice(0, 100),
				value: String(s.id),
			}))
		);
	}

	override async exec({ interaction, options }: SlashCommandOptions) {
		if (!interaction.guild) return;
		const ws = (this.client as any).websocket;

		const member = (interaction.member as GuildMember)?.roles ? (interaction.member as GuildMember) : await interaction.guild.members.fetch(interaction.user.id);
		const guildConfig = await getGuildConfig(ws, interaction.guild.id);

		if (!isGuildReviewer(member, guildConfig)) {
			const denied = new ContainerBuilder()
				.setAccentColor(0xef4444)
				.addTextDisplayComponents(new TextDisplayBuilder().setContent('You need a configured **Reviewer Role** or `Manage Server` permission to review submissions.'));
			return interaction.util.reply({
				components: [denied],
				display: true,
				ephemeral: true,
			});
		}

		const directId = options?.submission?.value ? String(options.submission.value).trim() : '';
		if (directId) {
			const [accent, sub] = await Promise.all([resolveUserAccent(ws, interaction.user.id), ws.get('yourapps', 'submissions', { id: directId, guild: interaction.guild.id }).catch(() => null)]);
			if (!sub) {
				const missing = new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(new TextDisplayBuilder().setContent(`Submission \`${directId}\` not found in this server.`));
				return interaction.util.reply({
					components: [missing],
					display: true,
					ephemeral: true,
				});
			}

			const container = buildSubmissionReviewV2({ guildId: interaction.guild.id, submission: sub, accent, returnPage: 0, filterPosId: 'all' });
			return interaction.util.reply({
				components: [container],
				display: true,
				ephemeral: true,
			});
		}

		const [accent, res] = await Promise.all([
			resolveUserAccent(ws, interaction.user.id),
			ws.get('yourapps', 'submissions', { guild: interaction.guild.id, status: 'pending', limit: 100 }).catch(() => null),
		]);
		const pending = extractItems(res);

		const container = buildReviewQueueV2({
			guildId: interaction.guild.id,
			guildName: interaction.guild.name,
			guildIconUrl: interaction.guild.iconURL({ extension: 'png', size: 256 }),
			pendingSubmissions: pending,
			accent,
			page: 0,
			filterPosId: 'all',
		});

		return interaction.util.reply({
			components: [container],
			display: true,
			ephemeral: true,
		});
	}
}
