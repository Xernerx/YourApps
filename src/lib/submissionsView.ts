/** @format */

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from 'discord.js';
import { getAppUrl } from './endpoints.js';
import { getDashboardSubmissionUrl } from './reviewFlow.js';

const SUBMISSIONS_PAGE_SIZE = 4;

const STATUS_META: Record<string, { icon: string; label: string }> = {
	pending: { icon: '⏳', label: 'Pending' },
	approved: { icon: '✅', label: 'Approved' },
	denied: { icon: '✖', label: 'Denied' },
	withdrawn: { icon: '🚫', label: 'Withdrawn' },
};

export function buildSubmissionsListV2(params: {
	guildId: string;
	titleName: string;
	thumbnailUrl?: string | null;
	submissions: any[];
	accent: number;
	scopeUserId: string;
	canReview: boolean;
	isSelfView?: boolean;
	page?: number;
	statusFilter?: string;
}): ContainerBuilder {
	const { guildId, titleName, thumbnailUrl, submissions, accent, scopeUserId, canReview, isSelfView = false, page = 0, statusFilter = 'all' } = params;
	const container = new ContainerBuilder().setAccentColor(accent);
	const webPortalUrl = `${getAppUrl()}/servers/${guildId}/applications`;

	if (submissions.length === 0) {
		const emptyMsg = isSelfView
			? `### ${titleName} • Submissions\nYou have not submitted any applications in this server yet. Run \`/apply\` or \`/positions\` to get started!`
			: scopeUserId !== 'all'
				? `### ${titleName} • Submissions\n<@${scopeUserId}> has not submitted any applications in this server.`
				: `### ${titleName} • Submissions\nNo applications have been submitted in this server yet.`;

		if (thumbnailUrl) {
			container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(emptyMsg)).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl)));
		} else {
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(emptyMsg));
		}
		return container;
	}

	const validStatus = ['pending', 'approved', 'denied'].includes(statusFilter) ? statusFilter : 'all';
	const filtered = validStatus === 'all' ? submissions : submissions.filter((s) => String(s.status) === validStatus);

	const totalPages = Math.max(1, Math.ceil(Math.max(1, filtered.length) / SUBMISSIONS_PAGE_SIZE));
	const safePage = Math.max(0, Math.min(totalPages - 1, page));
	const slice = filtered.slice(safePage * SUBMISSIONS_PAGE_SIZE, (safePage + 1) * SUBMISSIONS_PAGE_SIZE);

	const filterSuffix = validStatus !== 'all' ? ` (${STATUS_META[validStatus]?.label || validStatus})` : '';
	const subtitle =
		filtered.length === 0
			? `No submissions match the selected filter${filterSuffix}.`
			: `Showing **${safePage * SUBMISSIONS_PAGE_SIZE + 1}–${safePage * SUBMISSIONS_PAGE_SIZE + slice.length}** of **${filtered.length}** submission${filtered.length === 1 ? '' : 's'}${filterSuffix}.`;

	const headerContent = `### ${titleName} • Submissions\n${subtitle}`;
	if (thumbnailUrl) {
		container.addSectionComponents(
			new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent)).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl))
		);
	} else {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent));
	}

	container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

	if (slice.length === 0) {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*Switch the status filter below to view other submissions.*'));
	} else {
		slice.forEach((s, idx) => {
			const meta = STATUS_META[s.status] || { icon: '•', label: String(s.status || 'Unknown') };
			const relTime = s.createdAt ? ` • <t:${Math.floor(new Date(s.createdAt).getTime() / 1000)}:R>` : '';
			const line =
				scopeUserId === 'all'
					? `${meta.icon} **${s.userTag || s.userId}** (<@${s.userId}>) — **${s.positionName || 'Application'}**\n\`#${s.id}\` • ${meta.label}${relTime}`
					: `${meta.icon} **${s.positionName || 'Application'}** — **${meta.label}**\n\`#${s.id}\`${relTime}${s.reviewReason ? ` • *${String(s.reviewReason).slice(0, 80)}${String(s.reviewReason).length > 80 ? '…' : ''}*` : ''}`;

			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(line));

			const isPendingReview = canReview && s.status === 'pending';
			container.addActionRowComponents(
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(`ya:sub:view:${s.id}:${safePage}:${scopeUserId}:${validStatus}`)
						.setLabel(isPendingReview ? 'Review in Discord' : 'View in Discord')
						.setStyle(isPendingReview ? ButtonStyle.Primary : ButtonStyle.Secondary),
					new ButtonBuilder()
						.setLabel(canReview ? 'Review in Dashboard' : 'View on Web')
						.setURL(canReview ? getDashboardSubmissionUrl(guildId, String(s.id)) : webPortalUrl)
						.setStyle(ButtonStyle.Link)
				)
			);

			if (idx < slice.length - 1) {
				container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
			}
		});
	}

	if (submissions.length > 1) {
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		const counts = {
			pending: submissions.filter((s) => s.status === 'pending').length,
			approved: submissions.filter((s) => s.status === 'approved').length,
			denied: submissions.filter((s) => s.status === 'denied').length,
		};
		const statusSelect = new StringSelectMenuBuilder()
			.setCustomId(`ya:sub:status:${scopeUserId}`)
			.setPlaceholder('Filter by submission status...')
			.addOptions(
				{ label: `All Statuses (${submissions.length})`, value: 'all', default: validStatus === 'all' },
				{ label: `Pending (${counts.pending})`, value: 'pending', default: validStatus === 'pending' },
				{ label: `Approved (${counts.approved})`, value: 'approved', default: validStatus === 'approved' },
				{ label: `Denied (${counts.denied})`, value: 'denied', default: validStatus === 'denied' }
			);
		container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(statusSelect));
	}

	if (totalPages > 1) {
		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`ya:sub:page:${safePage - 1}:${scopeUserId}:${validStatus}`)
					.setLabel('← Previous')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(safePage <= 0),
				new ButtonBuilder()
					.setCustomId(`ya:sub:page:${safePage + 1}:${scopeUserId}:${validStatus}`)
					.setLabel('Next →')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(safePage >= totalPages - 1)
			)
		);
	}

	return container;
}

export function buildSubmissionInspectV2(params: {
	guildId: string;
	submission: any;
	accent: number;
	canReview: boolean;
	returnPage: number;
	scopeUserId: string;
	statusFilter: string;
}): ContainerBuilder {
	const { guildId, submission, accent, canReview, returnPage, scopeUserId, statusFilter } = params;
	const meta = STATUS_META[submission.status] || { icon: '•', label: String(submission.status || 'Unknown') };
	const cardColor = submission.status === 'approved' ? 0x22c55e : submission.status === 'denied' ? 0xef4444 : accent;
	const container = new ContainerBuilder().setAccentColor(cardColor);

	const submittedRel = submission.createdAt ? ` • Submitted <t:${Math.floor(new Date(submission.createdAt).getTime() / 1000)}:R>` : '';
	const metaLines = [
		`### Application • ${submission.positionName || 'Position'}`,
		`**Applicant:** <@${submission.userId}> (${submission.userTag || submission.userId})`,
		`**Submission ID:** \`${submission.id}\` • **Status:** ${meta.icon} ${meta.label}${submittedRel}`,
	];

	if (submission.reviewedBy) {
		metaLines.push(`**Reviewed By:** <@${submission.reviewedBy}>`);
	}
	if (submission.reviewReason) {
		metaLines.push(`**Note / Reason:** ${submission.reviewReason}`);
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
	if (canReview && submission.status === 'pending') {
		buttons.push(
			new ButtonBuilder().setCustomId(`ya:rev:approve:${submission.id}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(`ya:rev:approve_note:${submission.id}`).setLabel('Approve with Note').setEmoji('📝').setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId(`ya:rev:deny:${submission.id}`).setLabel('Deny').setEmoji('✖').setStyle(ButtonStyle.Danger)
		);
	}
	if (canReview) {
		buttons.push(
			new ButtonBuilder()
				.setLabel('Review in Dashboard')
				.setURL(getDashboardSubmissionUrl(guildId, String(submission.id)))
				.setStyle(ButtonStyle.Link)
		);
	}
	buttons.push(new ButtonBuilder().setCustomId(`ya:sub:page:${returnPage}:${scopeUserId}:${statusFilter}`).setLabel('← Back to Submissions').setStyle(ButtonStyle.Secondary));

	container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons));

	return container;
}
