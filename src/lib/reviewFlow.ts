/** @format */

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	ContainerBuilder,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
	ThumbnailBuilder,
	type ButtonInteraction,
	type Guild,
	type GuildMember,
	type ModalSubmitInteraction,
} from 'discord.js';
import { getAppUrl } from './endpoints.js';
import { getGuildConfig, syncGuildPanelsInBot, XERNERX_ACCENT_INT } from './guildSync.js';
import { isPositionReviewer, resolveInteractionMember } from './permissions.js';

const REVIEW_PAGE_SIZE = 4;

export const STATUS_LABELS: Record<string, string> = {
	pending: '⏳ Pending Review',
	interview: '🟣 In Interview',
	needs_info: '❓ Clarification Requested',
	approved: '✅ Approved',
	denied: '✖ Denied',
	withdrawn: '🚫 Withdrawn',
};

export const STATUS_COLORS: Record<string, number> = {
	pending: XERNERX_ACCENT_INT,
	interview: 0xa855f7,
	needs_info: 0xf59e0b,
	approved: 0x22c55e,
	denied: 0xef4444,
	withdrawn: 0x64748b,
};

export function getDashboardSubmissionUrl(guildId: string, submissionId: string): string {
	return `${getAppUrl()}/dashboard?tab=applications&guild=${encodeURIComponent(guildId)}&subView=submissions&submission=${encodeURIComponent(submissionId)}`;
}

export function formatDossierLine(submission: any): string | null {
	if (submission?.anonymous || !submission?.applicantMeta) return null;
	const parts: string[] = [];
	if (submission.applicantMeta.accountCreatedAt) {
		const ts = Math.floor(new Date(submission.applicantMeta.accountCreatedAt).getTime() / 1000);
		if (ts > 0) parts.push(`Account <t:${ts}:R>`);
	}
	if (submission.applicantMeta.guildJoinedAt) {
		const ts = Math.floor(new Date(submission.applicantMeta.guildJoinedAt).getTime() / 1000);
		if (ts > 0) parts.push(`Joined <t:${ts}:R>`);
	}
	if (typeof submission.applicantMeta.priorSubmissionsCount === 'number' && submission.applicantMeta.priorSubmissionsCount > 0) {
		parts.push(`${submission.applicantMeta.priorSubmissionsCount} prior app${submission.applicantMeta.priorSubmissionsCount === 1 ? '' : 's'}`);
	}
	return parts.length > 0 ? parts.join(' • ') : null;
}

function chunkLines(lines: string[], maxLen = 3500, maxChunks = 3): string[] {
	const chunks: string[] = [];
	let current = '';
	for (const block of lines) {
		const next = current ? `${current}\n\n${block}` : block;
		if (next.length > maxLen && current) {
			chunks.push(current);
			current = block.slice(0, maxLen);
			if (chunks.length >= maxChunks - 1) break;
		} else {
			current = next.slice(0, maxLen);
		}
	}
	if (current && chunks.length < maxChunks) chunks.push(current);
	return chunks;
}

export function buildLogMessageComponents(guildId: string, submission: any): ActionRowBuilder<ButtonBuilder>[] {
	const status = String(submission.status || 'pending');
	if (!['pending', 'interview', 'needs_info'].includes(status)) {
		return [];
	}

	const votes: any[] = Array.isArray(submission.votes) ? submission.votes : [];
	const upCount = votes.filter((v) => v.vote === 'up').length;
	const downCount = votes.filter((v) => v.vote === 'down').length;

	const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(`ya:rev:approve:${submission.id}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId(`ya:rev:approve_note:${submission.id}`).setLabel('Approve + Note').setEmoji('📝').setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId(`ya:rev:deny:${submission.id}`).setLabel('Deny').setEmoji('✖').setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId(`ya:rev:vote:up:${submission.id}`).setLabel(`${upCount}`).setEmoji('👍').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`ya:rev:vote:down:${submission.id}`).setLabel(`${downCount}`).setEmoji('👎').setStyle(ButtonStyle.Secondary)
	);

	const row2Buttons: ButtonBuilder[] = [];
	if (!submission.anonymous) {
		if (!submission.interviewChannelId) {
			row2Buttons.push(new ButtonBuilder().setCustomId(`ya:rev:interview:${submission.id}`).setLabel('Interview').setEmoji('💬').setStyle(ButtonStyle.Secondary));
		}
		row2Buttons.push(new ButtonBuilder().setCustomId(`ya:rev:ask:${submission.id}`).setLabel('Ask Applicant').setEmoji('❓').setStyle(ButtonStyle.Secondary));
	}
	row2Buttons.push(
		new ButtonBuilder().setCustomId(`ya:rev:note:${submission.id}`).setLabel('Staff Note').setEmoji('🗒️').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setLabel('Dashboard')
			.setURL(getDashboardSubmissionUrl(guildId, String(submission.id)))
			.setStyle(ButtonStyle.Link)
	);

	return [row1, new ActionRowBuilder<ButtonBuilder>().addComponents(...row2Buttons)];
}

export function buildSubmissionLogV2(params: { guildId: string; submission: any; position?: any; colorOverride?: number; pingContent?: string; includeActions?: boolean }): ContainerBuilder {
	const { guildId, submission, position, colorOverride, pingContent, includeActions = true } = params;
	const answers: any[] = Array.isArray(submission.answers) ? submission.answers : [];
	const isAnonymous = Boolean(submission.anonymous || position?.anonymousResponses);
	const statusKey = String(submission.status || 'pending');
	const color = colorOverride ?? STATUS_COLORS[statusKey] ?? XERNERX_ACCENT_INT;

	const votes: any[] = Array.isArray(submission.votes) ? submission.votes : [];
	const upCount = votes.filter((v) => v.vote === 'up').length;
	const downCount = votes.filter((v) => v.vote === 'down').length;
	const notesCount = Array.isArray(submission.internalNotes) ? submission.internalNotes.length : 0;
	const dossier = formatDossierLine(submission);

	const titlePrefix = statusKey === 'pending' ? 'New Application' : (STATUS_LABELS[statusKey] || statusKey).replace(/^[^\w]+/, '').trim();
	const headerLines = [
		pingContent ? pingContent : null,
		`### ${titlePrefix} • ${submission.positionName || position?.name || 'Position'}`,
		isAnonymous ? '**Applicant:** *Anonymous Respondent*' : `**Applicant:** <@${submission.userId}> (${submission.userTag || submission.userId})`,
		`**Submission ID:** \`${submission.id}\` • **Status:** ${STATUS_LABELS[statusKey] || statusKey}`,
		dossier ? `**Applicant Dossier:** ${dossier}` : null,
		votes.length > 0 || notesCount > 0 ? `**Staff Activity:** 👍 ${upCount} • 👎 ${downCount}${notesCount > 0 ? ` • 🗒️ ${notesCount} note${notesCount === 1 ? '' : 's'}` : ''}` : null,
		submission.interviewChannelId ? `**Interview Room:** <#${submission.interviewChannelId}>` : null,
		submission.reviewedBy ? `**Reviewed By:** <@${submission.reviewedBy}>` : null,
		submission.reviewReason ? `**Note / Reason:** ${submission.reviewReason}` : null,
	]
		.filter(Boolean)
		.join('\n');

	const container = new ContainerBuilder().setAccentColor(color);

	if (!isAnonymous && submission.userAvatar?.startsWith('http')) {
		container.addSectionComponents(
			new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(headerLines.slice(0, 3800))).setThumbnailAccessory(new ThumbnailBuilder().setURL(submission.userAvatar))
		);
	} else {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerLines.slice(0, 3800)));
	}

	if (answers.length > 0) {
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		const answerBlocks = answers.slice(0, 25).map((a, idx) => `**${idx + 1}. ${String(a.question || 'Question').slice(0, 240)}**\n${String(a.answer || '*No answer provided*').slice(0, 900)}`);
		for (const chunk of chunkLines(answerBlocks, 3500, 3)) {
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
		}
	}

	const clarifications: any[] = Array.isArray(submission.clarifications) ? submission.clarifications : [];
	if (clarifications.length > 0) {
		const latest = clarifications[clarifications.length - 1];
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**❓ Follow-Up Question (${clarifications.length})**\n**Q:** ${String(latest.prompt || '').slice(0, 450)}\n**A:** ${latest.response ? String(latest.response).slice(0, 500) : '*Awaiting applicant response...*'}`
			)
		);
	}

	if (includeActions) {
		const rows = buildLogMessageComponents(guildId, submission);
		if (rows.length > 0) {
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
			container.addActionRowComponents(...rows);
		}
	}

	return container;
}

export async function refreshLogMessage(guild: Guild, submission: any, position?: any): Promise<void> {
	if (!submission?.logChannelId || !submission?.logMessageId) return;
	const logCh: any = await guild.channels.fetch(String(submission.logChannelId)).catch(() => null);
	const logMsg = logCh && typeof logCh.messages?.fetch === 'function' ? await logCh.messages.fetch(String(submission.logMessageId)).catch(() => null) : null;
	if (!logMsg) return;

	const container = buildSubmissionLogV2({ guildId: guild.id, submission, position, includeActions: true });
	if (logMsg.flags?.has(MessageFlags.IsComponentsV2)) {
		await logMsg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
	}
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
		const emptyText = `### ${guildName} • Review Queue\nAll caught up — there are currently **0** active submissions awaiting review!`;
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
		`Showing **${safePage * REVIEW_PAGE_SIZE + 1}–${safePage * REVIEW_PAGE_SIZE + slice.length}** of **${filtered.length}** active submission${filtered.length === 1 ? '' : 's'}${filterPosName ? ` for **${filterPosName}**` : ''}. Review directly in Discord or on the Dashboard.`,
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
		const statusIcon = s.status === 'interview' ? '🟣' : s.status === 'needs_info' ? '❓' : '⏳';
		const votes: any[] = Array.isArray(s.votes) ? s.votes : [];
		const upCount = votes.filter((v) => v.vote === 'up').length;
		const downCount = votes.filter((v) => v.vote === 'down').length;
		const voteBadge = votes.length > 0 ? ` • 👍 ${upCount} / 👎 ${downCount}` : '';
		const applicantText = s.anonymous ? '*Anonymous Respondent*' : `**${s.userTag || s.userId}** (<@${s.userId}>)`;
		const line = `${statusIcon} ${applicantText} — **${s.positionName || 'Application'}**\n\`#${s.id}\`${submittedRel}${voteBadge}`;

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
			.setPlaceholder('Filter active submissions by position...')
			.addOptions(
				{
					label: `All Positions (${pendingSubmissions.length} active)`,
					value: 'all',
					default: activeFilter === 'all',
				},
				...Array.from(byPosition.values())
					.slice(0, 24)
					.map((entry) => ({
						label: entry.name.slice(0, 100),
						value: entry.id,
						description: `${entry.count} active submission${entry.count === 1 ? '' : 's'}`,
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
	const statusKey = String(submission.status || 'pending');
	const cardColor = STATUS_COLORS[statusKey] ?? accent;
	const container = new ContainerBuilder().setAccentColor(cardColor);

	const votes: any[] = Array.isArray(submission.votes) ? submission.votes : [];
	const upCount = votes.filter((v) => v.vote === 'up').length;
	const downCount = votes.filter((v) => v.vote === 'down').length;
	const dossier = formatDossierLine(submission);

	const submittedRel = submission.createdAt ? ` • Submitted <t:${Math.floor(new Date(submission.createdAt).getTime() / 1000)}:R>` : '';
	const metaLines = [
		`### Application • ${submission.positionName || 'Position'}`,
		submission.anonymous ? '**Applicant:** *Anonymous Respondent*' : `**Applicant:** <@${submission.userId}> (${submission.userTag || submission.userId})`,
		`**Submission ID:** \`${submission.id}\` • **Status:** ${STATUS_LABELS[statusKey] || statusKey}${submittedRel}`,
	];

	if (dossier) {
		metaLines.push(`**Dossier:** ${dossier}`);
	}
	metaLines.push(`**Staff Votes:** 👍 **${upCount}** • 👎 **${downCount}**`);

	if (submission.interviewChannelId) {
		metaLines.push(`**Interview Room:** <#${submission.interviewChannelId}>`);
	}
	if (submission.reviewedBy) {
		metaLines.push(`**Reviewed By:** <@${submission.reviewedBy}>`);
	}
	if (submission.reviewReason) {
		metaLines.push(`**Note / Reason:** ${submission.reviewReason}`);
	}
	if (statusNotice) {
		metaLines.push(`\n*${statusNotice}*`);
	}

	const avatarUrl = !submission.anonymous && typeof submission.userAvatar === 'string' && submission.userAvatar.startsWith('http') ? submission.userAvatar : null;
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

		for (const chunk of chunks.slice(0, 3)) {
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
		}
	}

	const clarifications: any[] = Array.isArray(submission.clarifications) ? submission.clarifications : [];
	if (clarifications.length > 0) {
		const latest = clarifications[clarifications.length - 1];
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**❓ Follow-Up Question (${clarifications.length})**\n> ${String(latest.prompt || '').slice(0, 400)}\n**Applicant Reply:** ${latest.response ? String(latest.response).slice(0, 500) : '*Waiting for applicant...*'}`
			)
		);
	}

	const notes: any[] = Array.isArray(submission.internalNotes) ? submission.internalNotes : [];
	if (notes.length > 0) {
		const recentNotes = notes
			.slice(-3)
			.map((n) => `• <@${n.authorId}>: ${String(n.content || '').slice(0, 220)}`)
			.join('\n');
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**🗒️ Staff-Only Notes (${notes.length})**\n${recentNotes}`));
	}

	container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

	const isReviewable = ['pending', 'interview', 'needs_info'].includes(statusKey);
	if (isReviewable) {
		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`ya:rev:approve:${submission.id}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
				new ButtonBuilder().setCustomId(`ya:rev:approve_note:${submission.id}`).setLabel('Approve + Note').setEmoji('📝').setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId(`ya:rev:deny:${submission.id}`).setLabel('Deny').setEmoji('✖').setStyle(ButtonStyle.Danger),
				new ButtonBuilder().setCustomId(`ya:rev:vote:up:${submission.id}`).setLabel(`${upCount}`).setEmoji('👍').setStyle(ButtonStyle.Secondary),
				new ButtonBuilder().setCustomId(`ya:rev:vote:down:${submission.id}`).setLabel(`${downCount}`).setEmoji('👎').setStyle(ButtonStyle.Secondary)
			)
		);

		const secondRow: ButtonBuilder[] = [];
		if (!submission.anonymous) {
			if (!submission.interviewChannelId) {
				secondRow.push(new ButtonBuilder().setCustomId(`ya:rev:interview:${submission.id}`).setLabel('Interview').setEmoji('💬').setStyle(ButtonStyle.Secondary));
			} else {
				secondRow.push(new ButtonBuilder().setCustomId(`ya:rev:closeint:${submission.id}`).setLabel('Close Interview').setEmoji('🔒').setStyle(ButtonStyle.Secondary));
			}
			secondRow.push(new ButtonBuilder().setCustomId(`ya:rev:ask:${submission.id}`).setLabel('Ask Applicant').setEmoji('❓').setStyle(ButtonStyle.Secondary));
		}
		secondRow.push(
			new ButtonBuilder().setCustomId(`ya:rev:note:${submission.id}`).setLabel('Staff Note').setEmoji('🗒️').setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setLabel('Dashboard')
				.setURL(getDashboardSubmissionUrl(guildId, String(submission.id)))
				.setStyle(ButtonStyle.Link),
			new ButtonBuilder().setCustomId(`ya:rev:queue:${returnPage}:${filterPosId}`).setLabel('← Queue').setStyle(ButtonStyle.Secondary)
		);
		container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(...secondRow.slice(0, 5)));
	} else {
		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setLabel('View in Dashboard')
					.setURL(getDashboardSubmissionUrl(guildId, String(submission.id)))
					.setStyle(ButtonStyle.Link),
				new ButtonBuilder().setCustomId(`ya:rev:queue:${returnPage}:${filterPosId}`).setLabel('← Back to Queue').setStyle(ButtonStyle.Secondary)
			)
		);
	}

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

export function buildStaffNoteModal(submissionId: string): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(`ya:rev:notemodal:${submissionId}`)
		.setTitle('Add Internal Staff Note')
		.addLabelComponents(
			new LabelBuilder()
				.setLabel('Staff-Only Note')
				.setDescription('Visible only to reviewers and server admins — never shared with the applicant.')
				.setTextInputComponent(new TextInputBuilder().setCustomId('note').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000))
		);
}

export function buildAskApplicantModal(submissionId: string): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(`ya:rev:askmodal:${submissionId}`)
		.setTitle('Ask Applicant Follow-Up')
		.addLabelComponents(
			new LabelBuilder()
				.setLabel('Follow-Up Question')
				.setDescription('Sent to the applicant so they can submit a clarification response.')
				.setTextInputComponent(new TextInputBuilder().setCustomId('prompt').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000))
		);
}

export function buildApplicantClarifyModal(submissionId: string, promptSnippet?: string): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(`ya:sub:clarifymodal:${submissionId}`)
		.setTitle('Answer Follow-Up Question')
		.addLabelComponents(
			new LabelBuilder()
				.setLabel('Your Response')
				.setDescription((promptSnippet ? `Q: ${promptSnippet}` : 'Provide your clarification for the review team.').slice(0, 100))
				.setTextInputComponent(new TextInputBuilder().setCustomId('response').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000))
		);
}

async function closeDiscordInterviewRoom(guild: Guild, channelId: string, mode?: string | null, closedById?: string): Promise<void> {
	const ch: any = await guild.channels.fetch(channelId).catch(() => null);
	if (!ch) return;

	if (typeof ch.send === 'function') {
		const closedCard = new ContainerBuilder()
			.setAccentColor(0x64748b)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`### 🔒 Interview Closed\n${closedById ? `This interview room was closed by <@${closedById}>.` : 'This interview room has been closed.'}`)
			);
		await ch.send({ components: [closedCard], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
	}

	if (mode === 'channel' && typeof ch.delete === 'function') {
		await ch.delete('YourApps: Interview closed').catch(() => null);
	} else if (typeof ch.setArchived === 'function') {
		await ch.setLocked(true).catch(() => null);
		await ch.setArchived(true).catch(() => null);
	}
}

export async function handleReviewerVote(interaction: ButtonInteraction, ws: any, submissionId: string, voteDir: 'up' | 'down') {
	if (!interaction.guild) return;
	const [member, guildConfig, submission] = await Promise.all([
		resolveInteractionMember(interaction),
		getGuildConfig(ws, interaction.guild.id),
		ws.get('yourapps', 'submissions', { id: submissionId, guild: interaction.guild.id }).catch(() => null),
	]);
	if (!submission) {
		await interaction.util.reply({ content: 'Submission not found.', ephemeral: true });
		return;
	}

	const position = await ws.get('yourapps', 'forms', { id: submission.positionId, guild: interaction.guild.id }).catch(() => null);
	if (!isPositionReviewer(member, guildConfig, position, interaction.memberPermissions)) {
		await interaction.util.reply({ content: 'You need a configured **Reviewer Role** for this position to vote.', ephemeral: true });
		return;
	}

	if (!guildConfig?.selfReviewAllowed && String(submission.userId) === interaction.user.id) {
		await interaction.util.reply({ content: 'Self-review is disabled: you cannot vote on your own application.', ephemeral: true });
		return;
	}

	const updated = await ws.update('yourapps', 'submissions', {
		id: submissionId,
		guild: interaction.guild.id,
		op: 'vote',
		voterId: interaction.user.id,
		voterTag: interaction.user.tag || interaction.user.username,
		vote: voteDir,
	});

	if (!updated) return;

	const netVotes = Number(updated.netVotes) || 0;
	const upCount = Number(updated.upvotes) || 0;
	const downCount = Number(updated.downvotes) || 0;
	const autoApprove = Number(position?.autoApproveVotes) || 0;
	const autoDeny = Number(position?.autoDenyVotes) || 0;

	if (['pending', 'interview', 'needs_info'].includes(String(updated.status))) {
		if (autoApprove > 0 && netVotes >= autoApprove) {
			await processReviewDecision(interaction, ws, submissionId, 'approved', `Auto-approved by staff consensus (+${netVotes} net votes).`, true);
			return;
		}
		if (autoDeny > 0 && downCount - upCount >= autoDeny) {
			await processReviewDecision(interaction, ws, submissionId, 'denied', `Auto-denied by staff consensus (-${downCount - upCount} net votes).`, true);
			return;
		}
	}

	await refreshLogMessage(interaction.guild, updated, position);

	const isEphemeralInspector = Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral));
	if (isEphemeralInspector) {
		const container = buildSubmissionReviewV2({
			guildId: interaction.guild.id,
			submission: updated,
			accent: XERNERX_ACCENT_INT,
			statusNotice: `Vote recorded (👍 ${upCount} • 👎 ${downCount}).`,
		});
		await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
	} else {
		await interaction.deferUpdate().catch(() => null);
	}
}

export async function handleStaffNoteSubmit(interaction: ModalSubmitInteraction, ws: any, submissionId: string) {
	if (!interaction.guild) return;
	const note = interaction.fields.getTextInputValue('note').trim();
	const [member, guildConfig, submission] = await Promise.all([
		resolveInteractionMember(interaction),
		getGuildConfig(ws, interaction.guild.id),
		ws.get('yourapps', 'submissions', { id: submissionId, guild: interaction.guild.id }).catch(() => null),
	]);
	if (!submission) {
		await interaction.util.reply({ content: 'Submission not found.', ephemeral: true });
		return;
	}
	const position = await ws.get('yourapps', 'forms', { id: submission.positionId, guild: interaction.guild.id }).catch(() => null);
	if (!isPositionReviewer(member, guildConfig, position, interaction.memberPermissions)) {
		await interaction.util.reply({ content: 'Reviewer permission required.', ephemeral: true });
		return;
	}

	const isEphemeralInspector = Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral)) && interaction.isFromMessage();
	if (isEphemeralInspector) await interaction.deferUpdate();
	else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const updated = await ws.update('yourapps', 'submissions', {
		id: submissionId,
		guild: interaction.guild.id,
		op: 'addNote',
		authorId: interaction.user.id,
		authorTag: interaction.user.tag || interaction.user.username,
		content: note,
	});

	await refreshLogMessage(interaction.guild, updated, position);

	if (isEphemeralInspector) {
		const container = buildSubmissionReviewV2({
			guildId: interaction.guild.id,
			submission: updated,
			accent: XERNERX_ACCENT_INT,
			statusNotice: 'Internal staff note saved.',
		});
		await interaction.util.reply({ components: [container], display: true });
		return;
	}

	await interaction.util.reply({ content: `🗒️ Internal staff note added to \`#${submissionId}\`.` });
}

export async function handleAskApplicantSubmit(interaction: ModalSubmitInteraction, ws: any, submissionId: string) {
	if (!interaction.guild) return;
	const prompt = interaction.fields.getTextInputValue('prompt').trim();
	const [member, guildConfig, submission] = await Promise.all([
		resolveInteractionMember(interaction),
		getGuildConfig(ws, interaction.guild.id),
		ws.get('yourapps', 'submissions', { id: submissionId, guild: interaction.guild.id }).catch(() => null),
	]);
	if (!submission || submission.anonymous) {
		await interaction.util.reply({ content: 'Cannot request clarification on this submission.', ephemeral: true });
		return;
	}
	const position = await ws.get('yourapps', 'forms', { id: submission.positionId, guild: interaction.guild.id }).catch(() => null);
	if (!isPositionReviewer(member, guildConfig, position, interaction.memberPermissions)) {
		await interaction.util.reply({ content: 'Reviewer permission required.', ephemeral: true });
		return;
	}

	const isEphemeralInspector = Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral)) && interaction.isFromMessage();
	if (isEphemeralInspector) await interaction.deferUpdate();
	else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const updated = await ws.update('yourapps', 'submissions', {
		id: submissionId,
		guild: interaction.guild.id,
		op: 'requestClarification',
		requestedBy: interaction.user.id,
		requestedByTag: interaction.user.tag || interaction.user.username,
		prompt,
	});

	await refreshLogMessage(interaction.guild, updated, position);

	if (guildConfig?.dmNotifications !== false) {
		const applicant = await interaction.client.users.fetch(String(submission.userId)).catch(() => null);
		if (applicant) {
			const webUrl = `${getAppUrl()}/servers/${encodeURIComponent(interaction.guild.id)}/applications`;
			const dmCard = new ContainerBuilder()
				.setAccentColor(0xf59e0b)
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`### ❓ Follow-Up Question • ${submission.positionName}\nA reviewer in **${interaction.guild.name}** asked a follow-up question on your application (\`#${submission.id}\`):\n\n> ${prompt.slice(0, 900)}\n\nRun \`/submissions\` inside **${interaction.guild.name}** or click below to reply on the web.`
					)
				)
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel('Answer on Web').setURL(webUrl).setStyle(ButtonStyle.Link)));
			await applicant.send({ components: [dmCard], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
		}
	}

	if (isEphemeralInspector) {
		const container = buildSubmissionReviewV2({
			guildId: interaction.guild.id,
			submission: updated,
			accent: 0xf59e0b,
			statusNotice: 'Follow-up question sent to applicant.',
		});
		await interaction.util.reply({ components: [container], display: true });
		return;
	}

	await interaction.util.reply({ content: `❓ Follow-up question sent to <@${submission.userId}> for \`#${submission.id}\`.` });
}

export async function handleApplicantClarifySubmit(interaction: ModalSubmitInteraction, ws: any, submissionId: string) {
	if (!interaction.guild) return;
	const responseText = interaction.fields.getTextInputValue('response').trim();
	const isV2Card = Boolean(interaction.message?.flags?.has(MessageFlags.IsComponentsV2)) && interaction.isFromMessage();
	if (isV2Card) await interaction.deferUpdate();
	else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const updated = await ws
		.update('yourapps', 'submissions', {
			id: submissionId,
			guild: interaction.guild.id,
			op: 'respondClarification',
			userId: interaction.user.id,
			response: responseText,
		})
		.catch(() => null);

	if (!updated) {
		await interaction.util.reply({ content: 'Could not submit your clarification response.', ephemeral: true });
		return;
	}

	const position = await ws.get('yourapps', 'forms', { id: updated.positionId, guild: interaction.guild.id }).catch(() => null);
	await refreshLogMessage(interaction.guild, updated, position);

	if (updated.threadId) {
		const thread: any = await interaction.guild.channels.fetch(String(updated.threadId)).catch(() => null);
		if (thread && typeof thread.send === 'function') {
			const clarCard = new ContainerBuilder()
				.setAccentColor(XERNERX_ACCENT_INT)
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### 📝 Applicant Answered Clarification\n<@${interaction.user.id}> replied:\n\n> ${responseText.slice(0, 1500)}`));
			await thread.send({ components: [clarCard], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
		}
	}

	await interaction.util.reply({
		content: `✅ Your response has been attached to application \`#${submissionId}\` and returned to the review queue.`,
		ephemeral: true,
	});
}

export async function handleApplicantWithdraw(interaction: ButtonInteraction, ws: any, submissionId: string) {
	if (!interaction.guild) return;
	const existing = await ws.get('yourapps', 'submissions', { id: submissionId, guild: interaction.guild.id }).catch(() => null);
	if (!existing || String(existing.userId) !== interaction.user.id) {
		await interaction.util.reply({ content: 'You can only withdraw your own active applications.', ephemeral: true });
		return;
	}
	if (!['pending', 'needs_info', 'interview'].includes(String(existing.status))) {
		await interaction.util.reply({ content: `This application is already **${existing.status}**.`, ephemeral: true });
		return;
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const position = await ws.get('yourapps', 'forms', { id: existing.positionId, guild: interaction.guild.id }).catch(() => null);
	const pendingRoles: string[] = Array.isArray(position?.pendingRoles) ? position.pendingRoles.map(String).filter(Boolean) : [];
	if (pendingRoles.length > 0 && !existing.anonymous) {
		const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
		if (member) await member.roles.remove(pendingRoles, 'YourApps: Application withdrawn').catch(() => null);
	}

	if (existing.interviewChannelId) {
		await closeDiscordInterviewRoom(interaction.guild, String(existing.interviewChannelId), existing.interviewMode, interaction.user.id);
	}

	const updated = await ws.update('yourapps', 'submissions', {
		id: submissionId,
		guild: interaction.guild.id,
		op: 'withdraw',
		userId: interaction.user.id,
	});

	await refreshLogMessage(interaction.guild, updated, position);

	await interaction.util.reply({
		content: `🚫 Your application \`#${submissionId}\` for **${existing.positionName}** has been withdrawn.`,
	});
}

export async function handleOpenInterview(interaction: ButtonInteraction, ws: any, submissionId: string) {
	if (!interaction.guild) return;
	const [member, guildConfig, submission] = await Promise.all([
		resolveInteractionMember(interaction),
		getGuildConfig(ws, interaction.guild.id),
		ws.get('yourapps', 'submissions', { id: submissionId, guild: interaction.guild.id }).catch(() => null),
	]);
	if (!submission || submission.anonymous) {
		await interaction.util.reply({ content: 'Cannot open an interview for this submission.', ephemeral: true });
		return;
	}

	const position = await ws.get('yourapps', 'forms', { id: submission.positionId, guild: interaction.guild.id }).catch(() => null);
	if (!isPositionReviewer(member, guildConfig, position, interaction.memberPermissions)) {
		await interaction.util.reply({ content: 'Reviewer permission required.', ephemeral: true });
		return;
	}

	if (submission.interviewChannelId) {
		await interaction.util.reply({ content: `An interview room is already open at <#${submission.interviewChannelId}>.`, ephemeral: true });
		return;
	}

	const isEphemeralInspector = Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral));
	if (isEphemeralInspector) await interaction.deferUpdate();
	else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const reviewerRoles: string[] = Array.from(
		new Set([
			...(Array.isArray(guildConfig?.adminRoles) ? guildConfig.adminRoles.map(String) : []),
			...(Array.isArray(position?.reviewRolesOverride) && position.reviewRolesOverride.length > 0
				? position.reviewRolesOverride.map(String)
				: Array.isArray(guildConfig?.reviewRoles)
					? guildConfig.reviewRoles.map(String)
					: []),
		])
	).filter(Boolean);

	let createdRoom: any = null;
	let actualMode: 'thread' | 'channel' = guildConfig?.interviewMode === 'channel' ? 'channel' : 'thread';

	if (actualMode === 'channel') {
		const roomSlug = `interview-${String(submission.userTag || submission.userId)
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, '-')
			.slice(0, 32)}-${String(submission.id).slice(-4)}`;

		createdRoom = await interaction.guild.channels
			.create({
				name: roomSlug,
				type: ChannelType.GuildText,
				parent: guildConfig?.interviewCategoryId ? String(guildConfig.interviewCategoryId) : undefined,
				topic: `YourApps Interview • ${submission.positionName} • #${submission.id}`,
				permissionOverwrites: [
					{ id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
					{
						id: String(submission.userId),
						allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
					},
					...(interaction.client.user
						? [
								{
									id: interaction.client.user.id,
									allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
								},
							]
						: []),
					...reviewerRoles.slice(0, 20).map((rid) => ({
						id: rid,
						allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
					})),
				],
			})
			.catch(() => null);
	}

	if (!createdRoom) {
		const parentId = String(submission.logChannelId || position?.logChannelOverride || guildConfig?.logChannel || interaction.channelId || '').trim();
		const parentCh: any = parentId ? await interaction.guild.channels.fetch(parentId).catch(() => null) : null;
		if (parentCh && typeof parentCh.threads?.create === 'function') {
			const threadName = `💬 ${submission.userTag || submission.userId} • ${submission.positionName}`.slice(0, 95);
			createdRoom = await parentCh.threads
				.create({
					name: threadName,
					type: ChannelType.PrivateThread,
					invitable: false,
					autoArchiveDuration: 1440,
				})
				.catch(() =>
					parentCh.threads
						.create({
							name: threadName,
							type: ChannelType.PublicThread,
							autoArchiveDuration: 1440,
						})
						.catch(() => null)
				);

			if (createdRoom) {
				actualMode = 'thread';
				await createdRoom.members?.add(String(submission.userId)).catch(() => null);
				await createdRoom.members?.add(interaction.user.id).catch(() => null);
			}
		}
	}

	if (!createdRoom?.id) {
		await interaction.util.reply({
			content: 'Could not create an interview room. Check that YourApps has `Manage Threads` / `Manage Channels` permissions.',
			ephemeral: true,
		});
		return;
	}

	const rolePings = reviewerRoles
		.slice(0, 5)
		.map((r) => `<@&${r}>`)
		.join(' ');
	const roomRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(`ya:rev:approve:${submission.id}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId(`ya:rev:deny:${submission.id}`).setLabel('Deny').setEmoji('✖').setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId(`ya:rev:closeint:${submission.id}`).setLabel('Close Interview').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setLabel('Dashboard')
			.setURL(getDashboardSubmissionUrl(interaction.guild.id, String(submission.id)))
			.setStyle(ButtonStyle.Link)
	);

	const welcomeCard = new ContainerBuilder()
		.setAccentColor(0xa855f7)
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[
					`<@${submission.userId}> ${rolePings}`.trim(),
					`### 💬 Application Interview • ${submission.positionName}`,
					`Welcome <@${submission.userId}>! <@${interaction.user.id}> opened this private interview room regarding your application (\`#${submission.id}\`).\n\nReviewers can approve, deny, or close this interview anytime below.`,
				].join('\n')
			)
		)
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addActionRowComponents(roomRow);

	await createdRoom
		.send({
			components: [welcomeCard],
			flags: MessageFlags.IsComponentsV2,
			allowedMentions: { users: [String(submission.userId)], roles: reviewerRoles.slice(0, 5) },
		})
		.catch(() => null);

	const updated = await ws.update('yourapps', 'submissions', {
		id: submission.id,
		guild: interaction.guild.id,
		status: 'interview',
		interviewChannelId: String(createdRoom.id),
		interviewMode: actualMode,
	});

	await refreshLogMessage(interaction.guild, updated, position);

	if (isEphemeralInspector) {
		const container = buildSubmissionReviewV2({
			guildId: interaction.guild.id,
			submission: updated,
			accent: 0xa855f7,
			statusNotice: `Opened interview room <#${createdRoom.id}>.`,
		});
		await interaction.util.reply({ components: [container], display: true });
		return;
	}

	await interaction.util.reply({ content: `💬 Opened interview room <#${createdRoom.id}> for <@${submission.userId}>.` });
}

export async function handleCloseInterview(interaction: ButtonInteraction, ws: any, submissionId: string) {
	if (!interaction.guild) return;
	const [member, guildConfig, submission] = await Promise.all([
		resolveInteractionMember(interaction),
		getGuildConfig(ws, interaction.guild.id),
		ws.get('yourapps', 'submissions', { id: submissionId, guild: interaction.guild.id }).catch(() => null),
	]);
	if (!submission) {
		await interaction.util.reply({ content: 'Submission not found.', ephemeral: true });
		return;
	}
	const position = await ws.get('yourapps', 'forms', { id: submission.positionId, guild: interaction.guild.id }).catch(() => null);
	if (!isPositionReviewer(member, guildConfig, position, interaction.memberPermissions)) {
		await interaction.util.reply({ content: 'Reviewer permission required.', ephemeral: true });
		return;
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const nextStatus = submission.status === 'interview' ? 'pending' : submission.status;
	const updated = await ws.update('yourapps', 'submissions', {
		id: submissionId,
		guild: interaction.guild.id,
		status: nextStatus,
		interviewChannelId: null,
	});

	await refreshLogMessage(interaction.guild, updated, position);
	await interaction.util.reply({ content: `🔒 Closing interview room for \`#${submissionId}\`...` });

	if (submission.interviewChannelId) {
		await closeDiscordInterviewRoom(interaction.guild, String(submission.interviewChannelId), submission.interviewMode, interaction.user.id);
	}
}

export async function processReviewDecision(
	interaction: ButtonInteraction | ModalSubmitInteraction,
	ws: any,
	submissionId: string,
	decision: 'approved' | 'denied',
	reason: string | null,
	bypassMinVotes = false
) {
	if (!interaction.guild) return;

	const [member, guildConfig, submission] = await Promise.all([
		resolveInteractionMember(interaction),
		getGuildConfig(ws, interaction.guild.id),
		ws.get('yourapps', 'submissions', { id: submissionId, guild: interaction.guild.id }).catch(() => null),
	]);
	if (!submission) {
		await interaction.util.reply({
			content: `Submission \`${submissionId}\` could not be found.`,
			ephemeral: true,
		});
		return;
	}

	const position = await ws.get('yourapps', 'forms', { id: submission.positionId, guild: interaction.guild.id }).catch(() => null);
	if (!isPositionReviewer(member, guildConfig, position, interaction.memberPermissions)) {
		await interaction.util.reply({
			content: 'You need a configured **Reviewer Role** or `Manage Server` permission to review this application.',
			ephemeral: true,
		});
		return;
	}

	if (!['pending', 'interview', 'needs_info'].includes(String(submission.status))) {
		await interaction.util.reply({
			content: `Submission \`${submission.id}\` has already been **${submission.status}**${submission.reviewedBy ? ` by <@${submission.reviewedBy}>` : ''}.`,
			ephemeral: true,
		});
		return;
	}

	if (!guildConfig?.selfReviewAllowed && String(submission.userId) === interaction.user.id) {
		await interaction.util.reply({
			content: 'Self-review is disabled on this server: another reviewer must decide on your application.',
			ephemeral: true,
		});
		return;
	}

	const minVotes = Number(position?.minVotesToApprove) || 0;
	if (!bypassMinVotes && decision === 'approved' && minVotes > 0) {
		const upVotes = (Array.isArray(submission.votes) ? submission.votes : []).filter((v: any) => v.vote === 'up').length;
		if (upVotes < minVotes) {
			await interaction.util.reply({
				content: `This position requires at least **${minVotes}** staff upvote${minVotes === 1 ? '' : 's'} before approval (currently **${upVotes}**).`,
				ephemeral: true,
			});
			return;
		}
	}

	const isEphemeralInspector = Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral)) && (interaction.isButton() || interaction.isFromMessage());
	if (!interaction.deferred && !interaction.replied) {
		if (isEphemeralInspector) {
			await interaction.deferUpdate();
		} else {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		}
	}

	let roleNote = '';
	const pendingRoles: string[] = Array.isArray(position?.pendingRoles) ? position.pendingRoles.map(String).filter(Boolean) : [];

	if (position && !submission.anonymous) {
		const addRoles: string[] =
			decision === 'approved'
				? Array.isArray(position.rewardRoles)
					? position.rewardRoles.map(String).filter(Boolean)
					: []
				: Array.isArray(position.denyAddRoles)
					? position.denyAddRoles.map(String).filter(Boolean)
					: [];

		const baseRemove: string[] =
			decision === 'approved'
				? Array.isArray(position.removeRoles)
					? position.removeRoles.map(String).filter(Boolean)
					: []
				: Array.isArray(position.denyRemoveRoles)
					? position.denyRemoveRoles.map(String).filter(Boolean)
					: [];

		const removeRoles = Array.from(new Set([...baseRemove, ...pendingRoles])).filter((r) => !addRoles.includes(r));

		if (addRoles.length > 0 || removeRoles.length > 0) {
			const applicantMember = await interaction.guild.members.fetch(String(submission.userId)).catch(() => null);
			if (applicantMember) {
				try {
					if (addRoles.length > 0) await applicantMember.roles.add(addRoles, `YourApps: ${decision} for ${position.name}`);
					if (removeRoles.length > 0) await applicantMember.roles.remove(removeRoles, `YourApps: ${decision} for ${position.name}`);
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
		interviewChannelId: null,
	};

	const decisionColor = decision === 'approved' ? 0x22c55e : 0xef4444;
	const summaryContainer = buildSubmissionLogV2({
		guildId: interaction.guild.id,
		submission: updatedPayload,
		position,
		colorOverride: decisionColor,
		includeActions: false,
	});

	if (submission.logChannelId && submission.logMessageId) {
		const logCh: any = await interaction.guild.channels.fetch(String(submission.logChannelId)).catch(() => null);
		const logMsg = logCh && typeof logCh.messages?.fetch === 'function' ? await logCh.messages.fetch(String(submission.logMessageId)).catch(() => null) : null;
		if (logMsg && logMsg.flags?.has(MessageFlags.IsComponentsV2)) {
			await logMsg.edit({ components: [summaryContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
		}
	}

	let archiveMessageId: string | null = null;
	const archiveChId = String(position?.archiveChannelOverride || guildConfig?.archiveChannel || '').trim();
	if (archiveChId) {
		const archCh: any = await interaction.guild.channels.fetch(archiveChId).catch(() => null);
		if (archCh && typeof archCh.send === 'function') {
			const archMsg = await archCh.send({ components: [summaryContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
			if (archMsg?.id) archiveMessageId = String(archMsg.id);
		}
	}

	const wsUpdated = await ws.update('yourapps', 'submissions', {
		id: submission.id,
		guild: interaction.guild.id,
		status: decision,
		reviewedBy: interaction.user.id,
		reviewedByTag: interaction.user.tag || interaction.user.username,
		reviewReason: reason || null,
		reviewedAt: new Date().toISOString(),
		interviewChannelId: null,
		...(archiveMessageId ? { archiveMessageId } : {}),
	});

	if (wsUpdated?.formAutoClosed) {
		void syncGuildPanelsInBot(ws, interaction.guild);
	}

	if (guildConfig?.dmNotifications !== false && !submission.anonymous) {
		const applicantUser = await interaction.client.users.fetch(String(submission.userId)).catch(() => null);
		if (applicantUser) {
			const customNote = decision === 'approved' ? position?.acceptMessage : position?.denyMessage;
			const dmCard = new ContainerBuilder()
				.setAccentColor(decisionColor)
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						[
							`### ${decision === 'approved' ? '✅' : '✖'} Application ${decision === 'approved' ? 'Approved' : 'Denied'} • ${submission.positionName}`,
							`Your application in **${interaction.guild.name}** has been **${decision}**.`,
							customNote ? customNote : null,
							reason ? `**Reviewer Note:** ${reason}` : null,
						]
							.filter(Boolean)
							.join('\n\n')
					)
				);
			await applicantUser.send({ components: [dmCard], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
		}
	}

	if (isEphemeralInspector) {
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
	} else {
		const applicantRef = submission.anonymous ? '*Anonymous Respondent*' : `<@${submission.userId}>`;
		await interaction.util.reply({
			content: `${decision === 'approved' ? '✅ Approved' : '✖ Denied'} application \`${submission.id}\` (${applicantRef} for **${submission.positionName}**)${roleNote ? ` (${roleNote})` : ''}.`,
		});
	}

	if (submission.interviewChannelId) {
		void closeDiscordInterviewRoom(interaction.guild, String(submission.interviewChannelId), submission.interviewMode, interaction.user.id);
	}
}
