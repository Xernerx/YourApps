/** @format */

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	EmbedBuilder,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
	ThumbnailBuilder,
	type ButtonInteraction,
	type GuildMember,
	type ModalSubmitInteraction,
} from 'discord.js';
import { getAppUrl } from './endpoints.js';
import { getGuildConfig, XERNERX_ACCENT_INT } from './guildSync.js';
import { isGuildReviewer } from './permissions.js';

const REVIEW_PAGE_SIZE = 4;

const STATUS_LABELS: Record<string, string> = {
	pending: '⏳ Pending Review',
	approved: '✅ Approved',
	denied: '✖ Denied',
	withdrawn: '🚫 Withdrawn',
};

export function getDashboardSubmissionUrl(guildId: string, submissionId: string): string {
	return `${getAppUrl()}/dashboard?tab=applications&guild=${encodeURIComponent(guildId)}&subView=submissions&submission=${encodeURIComponent(submissionId)}`;
}

export function buildSubmissionReviewEmbed(submission: any, color = XERNERX_ACCENT_INT): EmbedBuilder {
	const answers: any[] = Array.isArray(submission.answers) ? submission.answers : [];

	const descLines = [
		`**Applicant:** <@${submission.userId}> (${submission.userTag || submission.userId})`,
		`**Position:** ${submission.positionName}`,
		`**Submission ID:** \`${submission.id}\``,
		`**Status:** ${STATUS_LABELS[submission.status] || submission.status}`,
	];

	if (submission.reviewedBy) {
		descLines.push(`**Reviewed By:** <@${submission.reviewedBy}>`);
	}
	if (submission.reviewReason) {
		descLines.push(`**Note / Reason:** ${submission.reviewReason}`);
	}

	return new EmbedBuilder()
		.setColor(color)
		.setTitle(`Application • ${submission.positionName}`)
		.setDescription(descLines.join('\n'))
		.addFields(
			answers.slice(0, 20).map((a, idx) => ({
				name: `${idx + 1}. ${String(a.question || 'Question').slice(0, 240)}`,
				value: String(a.answer || '*No answer provided*').slice(0, 1024),
			}))
		)
		.setTimestamp(submission.createdAt ? new Date(submission.createdAt) : new Date());
}

export function buildReviewButtonsRow(submissionId: string, guildId?: string): ActionRowBuilder<ButtonBuilder> {
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(`ya:rev:approve:${submissionId}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId(`ya:rev:approve_note:${submissionId}`).setLabel('Approve with Note').setEmoji('📝').setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId(`ya:rev:deny:${submissionId}`).setLabel('Deny').setEmoji('✖').setStyle(ButtonStyle.Danger)
	);
	if (guildId) {
		row.addComponents(new ButtonBuilder().setLabel('Review in Dashboard').setURL(getDashboardSubmissionUrl(guildId, submissionId)).setStyle(ButtonStyle.Link));
	}
	return row;
}

export function buildReviewQueueV2(params: {
	guildId: string;
	guildName: string;
	guildIconUrl?: string | null;
	pendingSubmissions: any[];
	accent: number;
	page?: number;
	filterPosId?: string;
}): ContainerBuilder {
	const { guildId, guildName, guildIconUrl, pendingSubmissions, accent, page = 0, filterPosId = 'all' } = params;
	const container = new ContainerBuilder().setAccentColor(accent);

	if (pendingSubmissions.length === 0) {
		const emptyText = `### ${guildName} • Review Queue\nAll caught up — there are currently **0** pending submissions awaiting review!`;
		if (guildIconUrl) {
			container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(emptyText)).setThumbnailAccessory(new ThumbnailBuilder().setURL(guildIconUrl)));
		} else {
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(emptyText));
		}
		return container;
	}

	const byPosition = new Map<string, { id: string; name: string; count: number }>();
	for (const s of pendingSubmissions) {
		const pid = String(s.positionId || '');
		if (!pid) continue;
		const existing = byPosition.get(pid);
		if (existing) existing.count++;
		else byPosition.set(pid, { id: pid, name: String(s.positionName || 'Position'), count: 1 });
	}

	const activeFilter = filterPosId !== 'all' && byPosition.has(filterPosId) ? filterPosId : 'all';
	const filtered = activeFilter === 'all' ? pendingSubmissions : pendingSubmissions.filter((s) => String(s.positionId) === activeFilter);

	const totalPages = Math.max(1, Math.ceil(filtered.length / REVIEW_PAGE_SIZE));
	const safePage = Math.max(0, Math.min(totalPages - 1, page));
	const slice = filtered.slice(safePage * REVIEW_PAGE_SIZE, (safePage + 1) * REVIEW_PAGE_SIZE);
	const filterPosName = activeFilter !== 'all' ? byPosition.get(activeFilter)?.name : null;

	const headerContent = [
		`### ${guildName} • Review Queue`,
		`Showing **${safePage * REVIEW_PAGE_SIZE + 1}–${safePage * REVIEW_PAGE_SIZE + slice.length}** of **${filtered.length}** pending submission${filtered.length === 1 ? '' : 's'}${filterPosName ? ` for **${filterPosName}**` : ''}. Review directly in Discord or on the Dashboard.`,
	].join('\n');

	if (guildIconUrl) {
		container.addSectionComponents(
			new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent)).setThumbnailAccessory(new ThumbnailBuilder().setURL(guildIconUrl))
		);
	} else {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent));
	}

	container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

	slice.forEach((s, idx) => {
		const submittedRel = s.createdAt ? ` • <t:${Math.floor(new Date(s.createdAt).getTime() / 1000)}:R>` : '';
		const line = `⏳ **${s.userTag || s.userId}** (<@${s.userId}>) — **${s.positionName || 'Application'}**\n\`#${s.id}\`${submittedRel}`;

		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(line));

		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`ya:rev:inspect:${s.id}:${safePage}:${activeFilter}`).setLabel('Review in Discord').setStyle(ButtonStyle.Primary),
				new ButtonBuilder()
					.setLabel('Review in Dashboard')
					.setURL(getDashboardSubmissionUrl(guildId, String(s.id)))
					.setStyle(ButtonStyle.Link)
			)
		);

		if (idx < slice.length - 1) {
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
		}
	});

	if (byPosition.size > 1) {
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		const filterMenu = new StringSelectMenuBuilder()
			.setCustomId('ya:rev:filterpos')
			.setPlaceholder('Filter pending submissions by position...')
			.addOptions(
				{
					label: `All Positions (${pendingSubmissions.length} pending)`,
					value: 'all',
					default: activeFilter === 'all',
				},
				...Array.from(byPosition.values())
					.slice(0, 24)
					.map((entry) => ({
						label: entry.name.slice(0, 100),
						value: entry.id,
						description: `${entry.count} pending submission${entry.count === 1 ? '' : 's'}`,
						default: activeFilter === entry.id,
					}))
			);
		container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(filterMenu));
	}

	if (totalPages > 1) {
		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`ya:rev:queue:${safePage - 1}:${activeFilter}`)
					.setLabel('← Previous')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(safePage <= 0),
				new ButtonBuilder()
					.setCustomId(`ya:rev:queue:${safePage + 1}:${activeFilter}`)
					.setLabel('Next →')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(safePage >= totalPages - 1)
			)
		);
	}

	return container;
}

export function buildSubmissionReviewV2(params: { guildId: string; submission: any; accent: number; returnPage?: number; filterPosId?: string; statusNotice?: string | null }): ContainerBuilder {
	const { guildId, submission, accent, returnPage = 0, filterPosId = 'all', statusNotice = null } = params;
	const cardColor = submission.status === 'approved' ? 0x22c55e : submission.status === 'denied' ? 0xef4444 : accent;
	const container = new ContainerBuilder().setAccentColor(cardColor);

	const submittedRel = submission.createdAt ? ` • Submitted <t:${Math.floor(new Date(submission.createdAt).getTime() / 1000)}:R>` : '';
	const metaLines = [
		`### Application • ${submission.positionName || 'Position'}`,
		`**Applicant:** <@${submission.userId}> (${submission.userTag || submission.userId})`,
		`**Submission ID:** \`${submission.id}\` • **Status:** ${STATUS_LABELS[submission.status] || submission.status}${submittedRel}`,
	];

	if (submission.reviewedBy) {
		metaLines.push(`**Reviewed By:** <@${submission.reviewedBy}>`);
	}
	if (submission.reviewReason) {
		metaLines.push(`**Note / Reason:** ${submission.reviewReason}`);
	}
	if (statusNotice) {
		metaLines.push(`\n*${statusNotice}*`);
	}

	const avatarUrl = typeof submission.userAvatar === 'string' && submission.userAvatar.startsWith('http') ? submission.userAvatar : null;
	if (avatarUrl) {
		container.addSectionComponents(
			new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(metaLines.join('\n'))).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl))
		);
	} else {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(metaLines.join('\n')));
	}

	container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

	const answers: any[] = Array.isArray(submission.answers) ? submission.answers : [];
	if (answers.length === 0) {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*No answers recorded.*'));
	} else {
		const chunks: string[] = [];
		let current = '';
		for (let i = 0; i < answers.length; i++) {
			const a = answers[i];
			const qText = String(a.question || `Question ${i + 1}`).slice(0, 240);
			const aText = String(a.answer || '*No answer provided*').slice(0, 1024);
			const block = `**${i + 1}. ${qText}**\n${aText}`;
			if (current && current.length + block.length + 2 > 3600) {
				chunks.push(current);
				current = block;
			} else {
				current = current ? `${current}\n\n${block}` : block;
			}
		}
		if (current) chunks.push(current);

		for (const chunk of chunks.slice(0, 4)) {
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
		}
	}

	container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

	const buttons: ButtonBuilder[] = [];
	if (submission.status === 'pending') {
		buttons.push(
			new ButtonBuilder().setCustomId(`ya:rev:approve:${submission.id}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(`ya:rev:approve_note:${submission.id}`).setLabel('Approve with Note').setEmoji('📝').setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId(`ya:rev:deny:${submission.id}`).setLabel('Deny').setEmoji('✖').setStyle(ButtonStyle.Danger)
		);
	}
	buttons.push(
		new ButtonBuilder()
			.setLabel('Review in Dashboard')
			.setURL(getDashboardSubmissionUrl(guildId, String(submission.id)))
			.setStyle(ButtonStyle.Link),
		new ButtonBuilder().setCustomId(`ya:rev:queue:${returnPage}:${filterPosId}`).setLabel('← Back to Queue').setStyle(ButtonStyle.Secondary)
	);

	container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons));

	return container;
}

export function buildReviewReasonModal(decision: 'approved' | 'denied', submissionId: string): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(`ya:rev:modal:${decision}:${submissionId}`)
		.setTitle(decision === 'approved' ? 'Approve Application' : 'Deny Application')
		.addLabelComponents(
			new LabelBuilder()
				.setLabel('Note / Reason (Optional)')
				.setDescription('Shared with the applicant (if DMs are enabled) and recorded in the archive.')
				.setTextInputComponent(new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
		);
}

export async function processReviewDecision(interaction: ButtonInteraction | ModalSubmitInteraction, ws: any, submissionId: string, decision: 'approved' | 'denied', reason: string | null) {
	if (!interaction.guild) return;

	const member = (interaction.member as GuildMember)?.roles ? (interaction.member as GuildMember) : await interaction.guild.members.fetch(interaction.user.id);

	const guildConfig = await getGuildConfig(ws, interaction.guild.id);
	if (!isGuildReviewer(member, guildConfig)) {
		await interaction.util.reply({
			content: 'You need a configured **Reviewer Role** or `Manage Server` permission to review applications.',
			ephemeral: true,
		});
		return;
	}

	const submission = await ws.get('yourapps', 'submissions', { id: submissionId, guild: interaction.guild.id }).catch(() => null);
	if (!submission) {
		await interaction.util.reply({
			content: `Submission \`${submissionId}\` could not be found.`,
			ephemeral: true,
		});
		return;
	}

	if (submission.status !== 'pending') {
		await interaction.util.reply({
			content: `Submission \`${submission.id}\` has already been **${submission.status}**${submission.reviewedBy ? ` by <@${submission.reviewedBy}>` : ''}.`,
			ephemeral: true,
		});
		return;
	}

	const isV2Card = Boolean(interaction.message?.flags?.has(MessageFlags.IsComponentsV2)) && (interaction.isButton() || interaction.isFromMessage());
	if (isV2Card) {
		await interaction.deferUpdate();
	} else {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	}

	const position = await ws.get('yourapps', 'forms', { id: submission.positionId, guild: interaction.guild.id }).catch(() => null);

	let roleNote = '';
	if (decision === 'approved' && position) {
		const rewardRoles: string[] = Array.isArray(position.rewardRoles) ? position.rewardRoles.map(String).filter(Boolean) : [];
		const removeRoles: string[] = Array.isArray(position.removeRoles) ? position.removeRoles.map(String).filter(Boolean) : [];
		if (rewardRoles.length > 0 || removeRoles.length > 0) {
			const applicantMember = await interaction.guild.members.fetch(String(submission.userId)).catch(() => null);
			if (applicantMember) {
				try {
					if (rewardRoles.length > 0) await applicantMember.roles.add(rewardRoles, `YourApps: Approved for ${position.name}`);
					if (removeRoles.length > 0) await applicantMember.roles.remove(removeRoles, `YourApps: Approved for ${position.name}`);
					roleNote = 'Roles updated automatically.';
				} catch {
					roleNote = 'Could not update some roles — check bot role hierarchy.';
				}
			} else {
				roleNote = 'Applicant is no longer in server.';
			}
		}
	}

	const updatedPayload = {
		...submission,
		status: decision,
		reviewedBy: interaction.user.id,
		reviewedByTag: interaction.user.tag || interaction.user.username,
		reviewReason: reason || null,
		reviewedAt: new Date().toISOString(),
	};

	const decisionColor = decision === 'approved' ? 0x22c55e : 0xef4444;
	const summaryEmbed = buildSubmissionReviewEmbed(updatedPayload, decisionColor);

	if (submission.logChannelId && submission.logMessageId) {
		const logCh: any = await interaction.guild.channels.fetch(String(submission.logChannelId)).catch(() => null);
		const logMsg = logCh && typeof logCh.messages?.fetch === 'function' ? await logCh.messages.fetch(String(submission.logMessageId)).catch(() => null) : null;
		if (logMsg) {
			await logMsg.edit({ embeds: [summaryEmbed], components: [] }).catch(() => null);
		}
	}

	let archiveMessageId: string | null = null;
	if (guildConfig?.archiveChannel) {
		const archCh: any = await interaction.guild.channels.fetch(String(guildConfig.archiveChannel)).catch(() => null);
		if (archCh && typeof archCh.send === 'function') {
			const archMsg = await archCh.send({ embeds: [summaryEmbed] }).catch(() => null);
			if (archMsg?.id) archiveMessageId = String(archMsg.id);
		}
	}

	await ws.update('yourapps', 'submissions', {
		id: submission.id,
		guild: interaction.guild.id,
		status: decision,
		reviewedBy: interaction.user.id,
		reviewedByTag: interaction.user.tag || interaction.user.username,
		reviewReason: reason || null,
		reviewedAt: new Date().toISOString(),
		...(archiveMessageId ? { archiveMessageId } : {}),
	});

	if (guildConfig?.dmNotifications !== false) {
		const applicantUser = await interaction.client.users.fetch(String(submission.userId)).catch(() => null);
		if (applicantUser) {
			const customNote = decision === 'approved' ? position?.acceptMessage : position?.denyMessage;
			const dmEmbed = new EmbedBuilder()
				.setColor(decisionColor)
				.setTitle(`Application ${decision === 'approved' ? 'Approved' : 'Denied'} • ${submission.positionName}`)
				.setDescription(
					[`Your application in **${interaction.guild.name}** has been **${decision}**.`, customNote ? `\n${customNote}` : null, reason ? `\n**Reviewer Note:** ${reason}` : null]
						.filter(Boolean)
						.join('\n')
				)
				.setTimestamp();
			await applicantUser.send({ embeds: [dmEmbed] }).catch(() => null);
		}
	}

	if (isV2Card) {
		const container = buildSubmissionReviewV2({
			guildId: interaction.guild.id,
			submission: updatedPayload,
			accent: decisionColor,
			statusNotice: roleNote || null,
		});
		await interaction.util.reply({
			components: [container],
			display: true,
		});
		return;
	}

	await interaction.util.reply({
		content: `${decision === 'approved' ? '✅ Approved' : '✖ Denied'} application \`${submission.id}\` (<@${submission.userId}> for **${submission.positionName}**)${roleNote ? ` (${roleNote})` : ''}.`,
	});
}
