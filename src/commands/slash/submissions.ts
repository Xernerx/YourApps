/** @format */

import { SlashCommandBuilder, type SlashCommandOptions } from '@xernerx/framework';
import { ContainerBuilder, TextDisplayBuilder, type GuildMember, type User } from 'discord.js';
import { extractItems, getGuildConfig, resolveUserAccent } from '../../lib/guildSync.js';
import { isGuildReviewer } from '../../lib/permissions.js';
import { buildSubmissionsListV2 } from '../../lib/submissionsView.js';

export async function replyWithSubmissionsV2(ws: any, interaction: any, targetUser?: User | null) {
	const guild = interaction.guild;
	if (!guild) return;

	const member = (interaction.member as GuildMember)?.roles ? (interaction.member as GuildMember) : await guild.members.fetch(interaction.user.id);
	const guildConfig = await getGuildConfig(ws, guild.id);
	const reviewer = isGuildReviewer(member, guildConfig);

	// Non-reviewers trying to filter on another user are blocked cleanly
	if (targetUser && targetUser.id !== interaction.user.id && !reviewer) {
		const denied = new ContainerBuilder()
			.setAccentColor(0xef4444)
			.addTextDisplayComponents(new TextDisplayBuilder().setContent('You need a configured **Reviewer Role** or `Manage Server` permission to view another member’s submissions.'));
		return interaction.util.reply({
			components: [denied],
			display: true,
			ephemeral: true,
		});
	}

	// Reviewers with no user option see all server submissions; non-reviewers default to their own submissions
	const effectiveUser: User | null = targetUser || (reviewer ? null : interaction.user);
	const scopeUserId = effectiveUser ? effectiveUser.id : 'all';

	const query: Record<string, any> = { guild: guild.id, limit: 100 };
	if (effectiveUser) {
		query.userId = effectiveUser.id;
	}

	const [accent, res] = await Promise.all([resolveUserAccent(ws, interaction.user.id), ws.get('yourapps', 'submissions', query).catch(() => null)]);
	const submissions = extractItems(res);

	const container = buildSubmissionsListV2({
		guildId: guild.id,
		titleName: effectiveUser ? effectiveUser.username : guild.name,
		thumbnailUrl: effectiveUser ? effectiveUser.displayAvatarURL({ extension: 'png', size: 128 }) : guild.iconURL({ extension: 'png', size: 256 }),
		submissions,
		accent,
		scopeUserId,
		canReview: reviewer,
		isSelfView: Boolean(effectiveUser && effectiveUser.id === interaction.user.id),
		page: 0,
		statusFilter: 'all',
	});

	return interaction.util.reply({
		components: [container],
		display: true,
		ephemeral: true,
	});
}

export default class SubmissionsCommand extends SlashCommandBuilder {
	constructor() {
		super('submissions', {
			name: 'submissions',
			description: 'View application submissions on this server.',
			defer: false,
			permissions: {
				user: ['ManageGuild'],
			},
			options: [
				{
					type: 'user',
					name: 'user',
					description: 'Filter submissions by a specific member.',
					required: false,
				},
			],
		});
	}

	override async exec({ interaction, options }: SlashCommandOptions) {
		if (!interaction.guild) return;
		const ws = (this.client as any).websocket;
		const targetUser: User | null = (options?.user as any)?.user || null;
		return replyWithSubmissionsV2(ws, interaction, targetUser);
	}
}
