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
import { formatDurationSeconds } from './permissions.js';

const PAGE_SIZE = 4;

export function buildPositionsListV2(params: { guildId: string; guildName: string; guildIconUrl?: string | null; positions: any[]; accent: number; page?: number }): ContainerBuilder {
	const { guildId, guildName, guildIconUrl, positions, accent, page = 0 } = params;
	const appUrl = getAppUrl();
	const container = new ContainerBuilder().setAccentColor(accent);

	if (positions.length === 0) {
		const dashboardUrl = `${appUrl}/dashboard?tab=applications&guild=${guildId}`;
		container.addSectionComponents(
			new SectionBuilder()
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`### ${guildName} • Application Positions\nNo application positions have been configured yet. Server admins can create forms and publish panels on the **Xernerx Dashboard**.`
					)
				)
				.setButtonAccessory(new ButtonBuilder().setLabel('Open Dashboard').setURL(dashboardUrl).setStyle(ButtonStyle.Link))
		);
		return container;
	}

	const totalPages = Math.max(1, Math.ceil(positions.length / PAGE_SIZE));
	const safePage = Math.max(0, Math.min(totalPages - 1, page));
	const slice = positions.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

	const headerContent = [
		`### ${guildName} • Application Positions`,
		`Showing **${safePage * PAGE_SIZE + 1}–${safePage * PAGE_SIZE + slice.length}** of **${positions.length}** position${positions.length === 1 ? '' : 's'}. Apply directly in Discord or on the web.`,
	].join('\n');

	if (guildIconUrl) {
		container.addSectionComponents(
			new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent)).setThumbnailAccessory(new ThumbnailBuilder().setURL(guildIconUrl))
		);
	} else {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent));
	}

	container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

	slice.forEach((p, idx) => {
		const isOpen = p.state === 'open';
		const qCount = Array.isArray(p.questions) ? p.questions.length : 0;
		const scheduleNotes: string[] = [];
		if (!isOpen && p.opensAt) {
			const ts = Math.floor(new Date(p.opensAt).getTime() / 1000);
			if (ts > 0) scheduleNotes.push(`Opens <t:${ts}:R>`);
		}
		if (isOpen && p.closesAt) {
			const ts = Math.floor(new Date(p.closesAt).getTime() / 1000);
			if (ts > 0) scheduleNotes.push(`Closes <t:${ts}:R>`);
		}
		const scheduleStr = scheduleNotes.length > 0 ? ` • ${scheduleNotes.join(' • ')}` : '';
		const descSnippet = p.description ? `\n${String(p.description).slice(0, 160)}${String(p.description).length > 160 ? '…' : ''}` : '';
		const webApplyUrl = `${appUrl}/servers/${encodeURIComponent(guildId)}/applications/${encodeURIComponent(String(p.id))}`;
		const isPoll = p.category === 'poll';

		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${isOpen ? '🟢' : '🔒'} **${p.name}** • \`${qCount} question${qCount === 1 ? '' : 's'}\`${scheduleStr}${descSnippet}`));

		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`ya:apply:start:${p.id}`)
					.setLabel(isOpen ? (isPoll ? 'Vote in Discord' : 'Apply in Discord') : 'Closed')
					.setStyle(isOpen ? ButtonStyle.Primary : ButtonStyle.Secondary)
					.setDisabled(!isOpen),
				new ButtonBuilder()
					.setLabel(isPoll ? 'Vote on Web' : 'Apply on Web')
					.setURL(webApplyUrl)
					.setStyle(ButtonStyle.Link)
					.setDisabled(!isOpen)
			)
		);

		if (idx < slice.length - 1) {
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
		}
	});

	container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

	const inspectSelect = new StringSelectMenuBuilder()
		.setCustomId(`ya:pos:inspect:${safePage}`)
		.setPlaceholder('View questions & eligibility for a position...')
		.addOptions(
			positions.slice(0, 25).map((pos) => ({
				label: String(pos.name).slice(0, 100),
				value: String(pos.id),
				description: `${pos.state === 'open' ? 'Open' : 'Closed'} • ${Array.isArray(pos.questions) ? pos.questions.length : 0} questions`.slice(0, 100),
			}))
		);

	container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(inspectSelect));

	if (totalPages > 1) {
		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`ya:pos:page:${safePage - 1}`)
					.setLabel('← Previous')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(safePage <= 0),
				new ButtonBuilder()
					.setCustomId(`ya:pos:page:${safePage + 1}`)
					.setLabel('Next →')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(safePage >= totalPages - 1)
			)
		);
	}

	return container;
}

export function buildPositionDetailV2(params: { guildId: string; position: any; accent: number; returnPage?: number }): ContainerBuilder {
	const { guildId, position: pos, accent, returnPage = 0 } = params;
	const isOpen = pos.state === 'open';
	const isPoll = pos.category === 'poll';
	const questions: any[] = Array.isArray(pos.questions) ? pos.questions : [];
	const webApplyUrl = `${getAppUrl()}/servers/${encodeURIComponent(guildId)}/applications/${encodeURIComponent(String(pos.id))}`;

	const qLines =
		questions.length > 0
			? questions
					.map((q, idx) => `**${idx + 1}.** ${q.question} *(${q.type}${q.required !== false ? ', required' : ''}${q.condition?.questionId ? ', conditional' : ''})*`)
					.join('\n')
					.slice(0, 2800)
			: '*No questions configured yet.*';

	const cooldown = pos.cooldown ? formatDurationSeconds(pos.cooldown) : 'None';
	const minJoin = pos.minimumJoinTime ? formatDurationSeconds(pos.minimumJoinTime) : 'None';
	const minAcct = pos.minimumAccountAge ? formatDurationSeconds(pos.minimumAccountAge) : 'None';
	const reqRoles = Array.isArray(pos.requiredRoles) && pos.requiredRoles.length > 0 ? pos.requiredRoles.map((r: string) => `<@&${r}>`).join(', ') : 'None';

	return new ContainerBuilder()
		.setAccentColor(accent)
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${isOpen ? '🟢' : '🔒'} ${pos.name}${pos.description ? `\n${String(pos.description).slice(0, 700)}` : ''}`))
		.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`ya:apply:start:${pos.id}`)
					.setLabel(isOpen ? (isPoll ? 'Vote in Discord' : 'Apply in Discord') : 'Closed')
					.setStyle(isOpen ? ButtonStyle.Primary : ButtonStyle.Secondary)
					.setDisabled(!isOpen),
				new ButtonBuilder()
					.setLabel(isPoll ? 'Vote on Web' : 'Apply on Web')
					.setURL(webApplyUrl)
					.setStyle(ButtonStyle.Link)
					.setDisabled(!isOpen)
			)
		)
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Questions (${questions.length})**\n${qLines}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Cooldown:** ${cooldown} • **Min Server Time:** ${minJoin} • **Min Account Age:** ${minAcct}\n**Required Roles:** ${reqRoles}`))
		.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`ya:pos:page:${returnPage}`).setLabel('← All Positions').setStyle(ButtonStyle.Secondary))
		);
}
