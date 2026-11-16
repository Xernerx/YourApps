/** @format */

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	CheckboxBuilder,
	CheckboxGroupBuilder,
	ContainerBuilder,
	EmbedBuilder,
	FileUploadBuilder,
	LabelBuilder,
	MentionableSelectMenuBuilder,
	ModalBuilder,
	RadioGroupBuilder,
	RoleSelectMenuBuilder,
	SectionBuilder,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
	UserSelectMenuBuilder,
	type ButtonInteraction,
	type ChatInputCommandInteraction,
	type GuildMember,
	type ModalSubmitInteraction,
	type StringSelectMenuInteraction,
} from 'discord.js';
import { getGuildConfig, resolveUserAccent, XERNERX_ACCENT_INT } from './guildSync.js';
import { checkApplicantEligibility } from './permissions.js';

export const MODAL_PAGE_SIZE = 5;

function buildLabelForQuestion(q: any, existingAnswer: string | undefined, questionNumber: number): LabelBuilder {
	const id = String(q.id);
	const rawQuestion = String(q.question || 'Question').trim();
	const prefix = `${questionNumber}. `;
	const fullTitle = `${prefix}${rawQuestion}`;
	const req = q.required !== false;
	const placeholder = String(q.placeholder || '').trim();
	const type = String(q.type || 'paragraph').toLowerCase();

	const label = new LabelBuilder();
	if (fullTitle.length <= 45) {
		label.setLabel(fullTitle);
		if (placeholder && ['radio', 'multiselect', 'boolean', 'checkbox', 'file'].includes(type)) {
			label.setDescription(placeholder.slice(0, 100));
		}
	} else {
		label.setLabel(`Question ${questionNumber}`);
		label.setDescription(rawQuestion.slice(0, 100));
	}

	const rawOpts: string[] = Array.isArray(q.options)
		? q.options
				.map((o: any) =>
					String(o || '')
						.trim()
						.slice(0, 100)
				)
				.filter(Boolean)
		: [];

	switch (type) {
		case 'select': {
			const opts = (rawOpts.length > 0 ? rawOpts : ['Option 1', 'Option 2']).slice(0, 25);
			const menu = new StringSelectMenuBuilder()
				.setCustomId(id)
				.setRequired(req)
				.addOptions(
					opts.map((opt) => ({
						label: opt,
						value: opt,
						default: existingAnswer === opt,
					}))
				);
			if (placeholder) menu.setPlaceholder(placeholder.slice(0, 100));
			return label.setStringSelectMenuComponent(menu);
		}

		case 'radio': {
			const opts = (rawOpts.length >= 2 ? rawOpts : rawOpts.length === 1 ? [rawOpts[0], 'Other'] : ['Option 1', 'Option 2']).slice(0, 10);
			const radio = new RadioGroupBuilder()
				.setCustomId(id)
				.setRequired(req)
				.addOptions(
					opts.map((opt) => ({
						label: opt,
						value: opt,
						default: existingAnswer === opt,
					}))
				);
			return label.setRadioGroupComponent(radio);
		}

		case 'multiselect': {
			const opts = (rawOpts.length > 0 ? rawOpts : ['Option 1']).slice(0, 10);
			const prevSet = new Set(
				(existingAnswer || '')
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			);
			const group = new CheckboxGroupBuilder()
				.setCustomId(id)
				.setRequired(req)
				.setMaxValues(opts.length)
				.addOptions(
					opts.map((opt) => ({
						label: opt,
						value: opt,
						default: prevSet.has(opt),
					}))
				);
			if (req) group.setMinValues(1);
			return label.setCheckboxGroupComponent(group);
		}

		case 'boolean': {
			const yesLabel = rawOpts[0]?.slice(0, 60) || 'Yes';
			const noLabel = rawOpts[1] && rawOpts[1] !== yesLabel ? rawOpts[1].slice(0, 60) : yesLabel === 'No' ? 'Other' : 'No';
			const yn = new RadioGroupBuilder()
				.setCustomId(id)
				.setRequired(req)
				.addOptions({ label: yesLabel, value: yesLabel, default: existingAnswer === yesLabel }, { label: noLabel, value: noLabel, default: existingAnswer === noLabel });
			return label.setRadioGroupComponent(yn);
		}

		case 'checkbox': {
			const cb = new CheckboxBuilder().setCustomId(id).setDefault(existingAnswer === 'Yes');
			return label.setCheckboxComponent(cb);
		}

		case 'user': {
			const menu = new UserSelectMenuBuilder().setCustomId(id).setRequired(req);
			if (placeholder) menu.setPlaceholder(placeholder.slice(0, 100));
			return label.setUserSelectMenuComponent(menu);
		}

		case 'role': {
			const menu = new RoleSelectMenuBuilder().setCustomId(id).setRequired(req);
			if (placeholder) menu.setPlaceholder(placeholder.slice(0, 100));
			return label.setRoleSelectMenuComponent(menu);
		}

		case 'channel': {
			const menu = new ChannelSelectMenuBuilder().setCustomId(id).setRequired(req);
			if (placeholder) menu.setPlaceholder(placeholder.slice(0, 100));
			return label.setChannelSelectMenuComponent(menu);
		}

		case 'mentionable': {
			const menu = new MentionableSelectMenuBuilder().setCustomId(id).setRequired(req);
			if (placeholder) menu.setPlaceholder(placeholder.slice(0, 100));
			return label.setMentionableSelectMenuComponent(menu);
		}

		case 'file': {
			const upload = new FileUploadBuilder().setCustomId(id).setRequired(req).setMaxValues(5);
			if (req) upload.setMinValues(1);
			return label.setFileUploadComponent(upload);
		}

		case 'short':
		case 'number':
		case 'paragraph':
		default: {
			const isShort = type === 'short' || type === 'number';
			const input = new TextInputBuilder()
				.setCustomId(id)
				.setStyle(isShort ? TextInputStyle.Short : TextInputStyle.Paragraph)
				.setRequired(req)
				.setMaxLength(Math.min(2000, Math.max(1, Number(q.maxLength) || (isShort ? 256 : 1000))));

			const hint = placeholder || (type === 'number' ? 'Enter a numeric value...' : '');
			if (hint) input.setPlaceholder(hint.slice(0, 100));
			if (existingAnswer !== undefined && existingAnswer !== '') {
				input.setValue(existingAnswer.slice(0, 2000));
			}
			return label.setTextInputComponent(input);
		}
	}
}

export function buildModalForQuestions(customId: string, title: string, questions: any[], existingAnswers: Map<string, string>, startNumber = 1): ModalBuilder {
	const modal = new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45));
	const labels = questions.slice(0, MODAL_PAGE_SIZE).map((q, i) => buildLabelForQuestion(q, existingAnswers.get(String(q.id)), startNumber + i));
	modal.addLabelComponents(...labels);
	return modal;
}

export function buildStepModal(position: any, pageIndex: number, existingAnswers: Map<string, string>, mode: 'init' | 'chain'): ModalBuilder {
	const questions: any[] = Array.isArray(position.questions) ? position.questions : [];
	const totalPages = Math.max(1, Math.ceil(questions.length / MODAL_PAGE_SIZE));
	const safePage = Math.max(0, Math.min(totalPages - 1, pageIndex));
	const startIdx = safePage * MODAL_PAGE_SIZE;
	const slice = questions.slice(startIdx, startIdx + MODAL_PAGE_SIZE);

	const suffix = totalPages > 1 ? ` (${safePage + 1}/${totalPages})` : '';
	const maxNameLen = 45 - suffix.length;
	const trimmedName = String(position.name || 'Application').slice(0, maxNameLen);
	const title = `${trimmedName}${suffix}`;

	return buildModalForQuestions(`ya:modal:step:${position.id}:${safePage}:${mode}`, title, slice, existingAnswers, startIdx + 1);
}

export function buildStepContinueV2(params: { position: any; nextPageIndex: number; accent: number; notice?: string | null; isRetry?: boolean }): ContainerBuilder {
	const { position, nextPageIndex, accent, notice = null, isRetry = false } = params;
	const questions: any[] = Array.isArray(position.questions) ? position.questions : [];
	const totalPages = Math.max(1, Math.ceil(questions.length / MODAL_PAGE_SIZE));
	const firstQ = nextPageIndex * MODAL_PAGE_SIZE + 1;
	const lastQ = Math.min(questions.length, (nextPageIndex + 1) * MODAL_PAGE_SIZE);

	const container = new ContainerBuilder().setAccentColor(isRetry ? 0xef4444 : accent);

	const bodyLines = isRetry
		? [`### ${position.name} • Check Step ${nextPageIndex + 1} of ${totalPages}`, notice || 'Please review your answers on this step and try again.']
		: [`### ${position.name} • Step ${nextPageIndex} of ${totalPages} Saved`, `Click **Continue** to open **Step ${nextPageIndex + 1} of ${totalPages}** *(Questions ${firstQ}–${lastQ})*.`];

	container.addSectionComponents(
		new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyLines.join('\n'))).setButtonAccessory(
			new ButtonBuilder()
				.setCustomId(`ya:draft:next:${position.id}:${nextPageIndex}`)
				.setLabel(isRetry ? `Retry Step ${nextPageIndex + 1} →` : `Continue (${nextPageIndex + 1}/${totalPages}) →`)
				.setStyle(ButtonStyle.Primary)
		)
	);

	return container;
}

export function extractModalAnswers(interaction: ModalSubmitInteraction, questions: any[], answersMap: Map<string, string>) {
	for (const q of questions || []) {
		const id = String(q.id);
		const type = String(q.type || 'paragraph').toLowerCase();

		if (!interaction.fields.fields.has(id)) continue;

		try {
			switch (type) {
				case 'select': {
					const vals = interaction.fields.getStringSelectValues(id) || [];
					answersMap.set(id, vals.join(', '));
					break;
				}
				case 'radio':
				case 'boolean': {
					const val = interaction.fields.getRadioGroup(id) || '';
					answersMap.set(id, val);
					break;
				}
				case 'multiselect': {
					const vals = interaction.fields.getCheckboxGroup(id) || [];
					answersMap.set(id, vals.join(', '));
					break;
				}
				case 'checkbox': {
					const checked = interaction.fields.getCheckbox(id);
					answersMap.set(id, checked ? 'Yes' : q.required !== false ? '' : 'No');
					break;
				}
				case 'user': {
					const users = interaction.fields.getSelectedUsers(id);
					const formatted = users
						? Array.from(users.values())
								.map((u) => `<@${u.id}> (${u.username})`)
								.join(', ')
						: '';
					answersMap.set(id, formatted);
					break;
				}
				case 'role': {
					const roles = interaction.fields.getSelectedRoles(id);
					const formatted = roles
						? Array.from(roles.values())
								.filter((r): r is NonNullable<typeof r> => Boolean(r))
								.map((r) => `<@&${r.id}> (@${r.name})`)
								.join(', ')
						: '';
					answersMap.set(id, formatted);
					break;
				}
				case 'channel': {
					const channels = interaction.fields.getSelectedChannels(id);
					const formatted = channels
						? Array.from(channels.values())
								.filter(Boolean)
								.map((c: any) => `<#${c.id}> (#${c.name || c.id})`)
								.join(', ')
						: '';
					answersMap.set(id, formatted);
					break;
				}
				case 'mentionable': {
					const ment = interaction.fields.getSelectedMentionables(id);
					const parts: string[] = [];
					if (ment?.users) {
						for (const u of ment.users.values()) {
							if (u) parts.push(`<@${u.id}> (${u.username})`);
						}
					}
					if (ment?.roles) {
						for (const r of ment.roles.values()) {
							if (r) parts.push(`<@&${r.id}> (@${r.name})`);
						}
					}
					answersMap.set(id, parts.join(', '));
					break;
				}
				case 'file': {
					const files = interaction.fields.getUploadedFiles(id);
					const formatted = files
						? Array.from(files.values())
								.map((f) => `[${f.name}](${f.url})`)
								.join('\n')
						: '';
					answersMap.set(id, formatted);
					break;
				}
				case 'short':
				case 'number':
				case 'paragraph':
				default: {
					const val = interaction.fields.getTextInputValue(id);
					answersMap.set(id, val);
					break;
				}
			}
		} catch {
			// Ignore unset optional fields
		}
	}
}

export function validateQuestionSlice(questions: any[], startIdx: number, answersMap: Map<string, string>): string | null {
	for (let offset = 0; offset < questions.length; offset++) {
		const q = questions[offset];
		const qNum = startIdx + offset + 1;
		const val = (answersMap.get(String(q.id)) || '').trim();
		if (q.required !== false && !val) {
			return q.type === 'checkbox' ? `Question #${qNum} (**${q.question}**) must be checked to continue.` : `Question #${qNum} (**${q.question}**) is required.`;
		}
		if (val && q.type === 'number' && Number.isNaN(Number(val))) {
			return `Question #${qNum} (**${q.question}**) expects a valid number (got \`${val.slice(0, 40)}\`).`;
		}
	}
	return null;
}

export async function beginApplicationInteraction(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction, ws: any, positionId: string) {
	if (!interaction.guild || !interaction.member) return;

	const member = (interaction.member as GuildMember).roles ? (interaction.member as GuildMember) : await interaction.guild.members.fetch(interaction.user.id);

	const [guildConfig, position, latestSub, draft] = await Promise.all([
		getGuildConfig(ws, interaction.guild.id),
		ws.get('yourapps', 'forms', { id: positionId, guild: interaction.guild.id }).catch(() => null),
		ws.get('yourapps', 'submissions', { guild: interaction.guild.id, positionId, userId: interaction.user.id, latestForUser: true }).catch(() => null),
		ws.get('yourapps', 'drafts', { guild: interaction.guild.id, userId: interaction.user.id, positionId }).catch(() => null),
	]);

	const check = checkApplicantEligibility({ member, guildConfig, position, latestSubmission: latestSub });
	if (!check.ok) {
		await interaction.util.reply({
			content: check.reason,
			ephemeral: true,
		});
		return;
	}

	const questions: any[] = Array.isArray(position.questions) ? position.questions : [];
	if (questions.length === 0) {
		await interaction.util.reply({
			content: 'This position does not have any questions configured yet.',
			ephemeral: true,
		});
		return;
	}

	const existingMap = new Map<string, string>();
	if (Array.isArray(draft?.answers)) {
		for (const a of draft.answers) {
			if (a?.questionId) existingMap.set(String(a.questionId), String(a.answer ?? ''));
		}
	}

	const totalPages = Math.max(1, Math.ceil(questions.length / MODAL_PAGE_SIZE));
	const resumeStep = typeof draft?.currentStep === 'number' && draft.currentStep >= 0 && draft.currentStep < totalPages ? draft.currentStep : 0;

	// Immediately launch the modal (Step 1 or resumed step) — zero upfront button picker!
	const modal = buildStepModal(position, resumeStep, existingMap, 'init');
	await interaction.showModal(modal);
}

export async function openDraftModalPage(interaction: ButtonInteraction, ws: any, positionId: string, pageIndex: number) {
	if (!interaction.guild) return;
	const [position, draft] = await Promise.all([
		ws.get('yourapps', 'forms', { id: positionId, guild: interaction.guild.id }).catch(() => null),
		ws.get('yourapps', 'drafts', { guild: interaction.guild.id, userId: interaction.user.id, positionId }).catch(() => null),
	]);

	if (!position) {
		await interaction.util.reply({ content: 'Position no longer exists.', ephemeral: true });
		return;
	}

	const answersMap = new Map<string, string>();
	if (Array.isArray(draft?.answers)) {
		for (const a of draft.answers) {
			if (a?.questionId) answersMap.set(String(a.questionId), String(a.answer ?? ''));
		}
	}

	const modal = buildStepModal(position, pageIndex, answersMap, 'chain');
	await interaction.showModal(modal);
}

export async function saveDraftAnswersMap(ws: any, guildId: string, userId: string, position: any, answersMap: Map<string, string>, currentStep = 0) {
	const answers = (position.questions || [])
		.filter((q: any) => answersMap.has(String(q.id)))
		.map((q: any) => ({
			questionId: String(q.id),
			question: String(q.question),
			type: String(q.type || 'paragraph'),
			answer: String(answersMap.get(String(q.id)) ?? ''),
		}));

	await ws.update('yourapps', 'drafts', {
		id: `${guildId}:${userId}:${position.id}`,
		guild: guildId,
		userId,
		positionId: position.id,
		currentStep,
		answers,
	});
}

export async function finalizeSubmission(interaction: ModalSubmitInteraction | ButtonInteraction, ws: any, position: any, answersMap: Map<string, string>) {
	if (!interaction.guild) return;

	const questions: any[] = Array.isArray(position.questions) ? position.questions : [];
	const accent = await resolveUserAccent(ws, interaction.user.id);

	for (let i = 0; i < questions.length; i++) {
		const q = questions[i];
		const val = (answersMap.get(String(q.id)) || '').trim();
		const isMissing = q.required !== false && !val;
		const isBadNumber = Boolean(val && q.type === 'number' && Number.isNaN(Number(val)));

		if (isMissing || isBadNumber) {
			const retryPage = Math.floor(i / MODAL_PAGE_SIZE);
			await saveDraftAnswersMap(ws, interaction.guild.id, interaction.user.id, position, answersMap, retryPage).catch(() => null);
			const errMsg = isBadNumber
				? `Question #${i + 1} (**${q.question}**) expects a valid number (got \`${val.slice(0, 40)}\`).`
				: q.type === 'checkbox'
					? `Question #${i + 1} (**${q.question}**) must be checked to submit.`
					: `Question #${i + 1} (**${q.question}**) is required.`;

			const retryCard = buildStepContinueV2({
				position,
				nextPageIndex: retryPage,
				accent,
				notice: errMsg,
				isRetry: true,
			});
			await interaction.util.reply({
				components: [retryCard],
				display: true,
				ephemeral: !interaction.deferred && !interaction.replied,
			});
			return;
		}
	}

	const answers = questions.map((q) => ({
		questionId: String(q.id),
		question: String(q.question),
		type: String(q.type || 'paragraph'),
		answer: (answersMap.get(String(q.id)) || '').trim(),
	}));

	const guildConfig = await getGuildConfig(ws, interaction.guild.id);
	const created = await ws.create('yourapps', 'submissions', {
		guild: interaction.guild.id,
		positionId: position.id,
		positionName: position.name,
		userId: interaction.user.id,
		userTag: interaction.user.tag || interaction.user.username,
		userAvatar: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
		answers,
	});

	if (created?.servicesDisabled) {
		const blockedCard = new ContainerBuilder()
			.setAccentColor(0xef4444)
			.addTextDisplayComponents(new TextDisplayBuilder().setContent('Submissions are unavailable while Xernerx Automatic Service Profiles are disabled on your account.'));
		await interaction.util.reply({ components: [blockedCard], display: true, ephemeral: !interaction.deferred && !interaction.replied });
		return;
	}

	if (guildConfig?.logChannel && created?.id) {
		try {
			const channel: any = await interaction.guild.channels.fetch(String(guildConfig.logChannel)).catch(() => null);
			if (channel && typeof channel.send === 'function') {
				const pingRoles: string[] = Array.isArray(guildConfig.submissionPings) ? guildConfig.submissionPings.map(String).filter(Boolean) : [];
				const pingContent = pingRoles.length > 0 ? pingRoles.map((r) => `<@&${r}>`).join(' ') : undefined;

				const logEmbed = new EmbedBuilder()
					.setColor(XERNERX_ACCENT_INT)
					.setTitle(`New Application • ${position.name}`)
					.setAuthor({
						name: `${interaction.user.tag || interaction.user.username} (${interaction.user.id})`,
						iconURL: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
					})
					.setDescription(`**Applicant:** <@${interaction.user.id}>\n**Position:** ${position.name}\n**Submission ID:** \`${created.id}\``)
					.addFields(
						answers.slice(0, 20).map((a, idx) => ({
							name: `${idx + 1}. ${a.question.slice(0, 240)}`,
							value: (a.answer || '*No answer provided*').slice(0, 1024),
						}))
					)
					.setTimestamp();

				const dashboardReviewUrl = `${(await import('./endpoints.js')).getAppUrl()}/dashboard?tab=applications&guild=${encodeURIComponent(interaction.guild.id)}&subView=submissions&submission=${encodeURIComponent(created.id)}`;
				const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId(`ya:rev:approve:${created.id}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
					new ButtonBuilder().setCustomId(`ya:rev:approve_note:${created.id}`).setLabel('Approve with Note').setEmoji('📝').setStyle(ButtonStyle.Primary),
					new ButtonBuilder().setCustomId(`ya:rev:deny:${created.id}`).setLabel('Deny').setEmoji('✖').setStyle(ButtonStyle.Danger),
					new ButtonBuilder().setLabel('Review in Dashboard').setURL(dashboardReviewUrl).setStyle(ButtonStyle.Link)
				);

				const sentMsg = await channel.send({
					content: pingContent,
					embeds: [logEmbed],
					components: [actionRow],
					allowedMentions: { roles: pingRoles },
				});

				let threadId: string | null = null;
				if (guildConfig.threadPerSubmission && sentMsg && typeof sentMsg.startThread === 'function') {
					const thread = await sentMsg
						.startThread({
							name: `${interaction.user.username} • ${position.name}`.slice(0, 95),
							autoArchiveDuration: 1440,
						})
						.catch(() => null);
					if (thread?.id) threadId = String(thread.id);
				}

				await ws
					.update('yourapps', 'submissions', {
						id: created.id,
						guild: interaction.guild.id,
						logChannelId: String(channel.id),
						logMessageId: String(sentMsg.id),
						...(threadId ? { threadId } : {}),
					})
					.catch(() => null);
			}
		} catch {
			// Do not fail applicant confirmation if log channel lacks permissions
		}
	}

	const confirmCard = new ContainerBuilder()
		.setAccentColor(0x22c55e)
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### ✅ Application Submitted!\nYour application for **${position.name}** has been submitted.\n\n**Submission ID:** \`${created.id}\`\nYou can check its status anytime inside this server with \`/submissions\`.`
			)
		);

	await interaction.util.reply({
		components: [confirmCard],
		display: true,
		ephemeral: !interaction.deferred && !interaction.replied,
	});
}
