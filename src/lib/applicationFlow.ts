/** @format */

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	CheckboxBuilder,
	CheckboxGroupBuilder,
	ContainerBuilder,
	FileUploadBuilder,
	LabelBuilder,
	MentionableSelectMenuBuilder,
	MessageFlags,
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
import { getGuildConfig, resolveUserAccent, syncGuildPanelsInBot } from './guildSync.js';
import { checkApplicantEligibility, getMemberRoleIds, isFullGuildMember, resolveInteractionMember } from './permissions.js';
import { buildSubmissionLogV2 } from './reviewFlow.js';
import { isQuestionActive, validateSingleAnswer } from './validation.js';

export const MODAL_PAGE_SIZE = 5;

export interface NumberedQuestion {
	question: any;
	displayNumber: number;
}

/**
 * Dynamically partitions form questions into Discord Modal steps (<= 5 per step):
 * - Questions whose parent condition already evaluated to false are skipped.
 * - If a question's condition references an unanswered question inside the current step,
 *   a step boundary is inserted so the parent answer is submitted before deciding whether to show the child question.
 */
export function computeDynamicModalSteps(questions: any[], answersMap: Map<string, string>): NumberedQuestion[][] {
	const steps: NumberedQuestion[][] = [];
	let currentStep: NumberedQuestion[] = [];
	let currentStepIds = new Set<string>();
	const includedIds = new Set<string>();
	let displayNum = 0;

	for (const q of questions || []) {
		const qId = String(q.id);
		const condRef = q?.condition?.questionId ? String(q.condition.questionId) : null;

		if (condRef && currentStepIds.has(condRef)) {
			if (currentStep.length > 0) {
				steps.push(currentStep);
				currentStep = [];
				currentStepIds = new Set<string>();
			}
		}

		if (condRef) {
			// If parent question was itself skipped, skip this dependent question too
			if (!includedIds.has(condRef)) {
				continue;
			}
			// If parent question has been answered already, evaluate the condition now
			if (answersMap.has(condRef) && !isQuestionActive(q, answersMap)) {
				continue;
			}
		}

		displayNum++;
		includedIds.add(qId);
		currentStep.push({ question: q, displayNumber: displayNum });
		currentStepIds.add(qId);

		if (currentStep.length >= MODAL_PAGE_SIZE) {
			steps.push(currentStep);
			currentStep = [];
			currentStepIds = new Set<string>();
		}
	}

	if (currentStep.length > 0) {
		steps.push(currentStep);
	}

	return steps;
}

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
		label.setLabel(fullTitle || `Question ${questionNumber}`);
		if (placeholder && ['radio', 'multiselect', 'boolean', 'checkbox', 'file'].includes(type)) {
			label.setDescription(placeholder.slice(0, 100));
		}
	} else {
		label.setLabel(`Question ${questionNumber}`);
		if (rawQuestion) {
			label.setDescription(rawQuestion.slice(0, 100));
		}
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
			const maxLen = Math.min(4000, Math.max(1, Number(q.maxLength) || (isShort ? 256 : 1000)));
			const minLen = q.minLength && Number(q.minLength) > 1 && req ? Math.min(maxLen, Math.min(4000, Math.max(1, Number(q.minLength)))) : 0;

			const input = new TextInputBuilder()
				.setCustomId(id)
				.setStyle(isShort ? TextInputStyle.Short : TextInputStyle.Paragraph)
				.setRequired(req)
				.setMaxLength(maxLen);

			if (minLen > 1) {
				input.setMinLength(minLen);
			}

			const rangeHint =
				type === 'number' && (q.minValue !== null || q.maxValue !== null)
					? `Enter a number${q.minValue !== null && q.minValue !== undefined ? ` >= ${q.minValue}` : ''}${q.maxValue !== null && q.maxValue !== undefined ? ` <= ${q.maxValue}` : ''}...`
					: '';
			const hint = placeholder || rangeHint || (type === 'number' ? 'Enter a numeric value...' : '');
			if (hint) input.setPlaceholder(hint.slice(0, 100));
			if (existingAnswer !== undefined && existingAnswer !== '') {
				const clipped = existingAnswer.slice(0, maxLen);
				if (clipped.length >= minLen) {
					input.setValue(clipped);
				}
			}
			return label.setTextInputComponent(input);
		}
	}
}

export function buildStepModal(position: any, pageIndex: number, existingAnswers: Map<string, string>, mode: 'init' | 'chain'): ModalBuilder {
	const questions: any[] = Array.isArray(position.questions) ? position.questions : [];
	const steps = computeDynamicModalSteps(questions, existingAnswers);
	const totalPages = Math.max(1, steps.length);
	const safePage = Math.max(0, Math.min(totalPages - 1, pageIndex));
	const stepItems = steps[safePage] || [];

	const suffix = totalPages > 1 ? ` (${safePage + 1}/${totalPages})` : '';
	const maxNameLen = 45 - suffix.length;
	const trimmedName = String(position.name || 'Application').slice(0, maxNameLen);
	const title = `${trimmedName}${suffix}`;

	const modal = new ModalBuilder().setCustomId(`ya:modal:step:${position.id}:${safePage}:${mode}`).setTitle(title.slice(0, 45));
	const labels = stepItems.slice(0, MODAL_PAGE_SIZE).map((item) => buildLabelForQuestion(item.question, existingAnswers.get(String(item.question.id)), item.displayNumber));
	modal.addLabelComponents(...labels);
	return modal;
}

export function buildStepContinueV2(params: { position: any; nextPageIndex: number; totalPages: number; accent: number; notice?: string | null; isRetry?: boolean }): ContainerBuilder {
	const { position, nextPageIndex, totalPages, accent, notice = null, isRetry = false } = params;

	const container = new ContainerBuilder().setAccentColor(isRetry ? 0xef4444 : accent);

	const bodyLines = isRetry
		? [`### ${position.name} • Check Step ${nextPageIndex + 1} of ${totalPages}`, notice || 'Please review your answers on this step and try again.']
		: [`### ${position.name} • Step ${nextPageIndex} of ${totalPages} Saved`, `Click **Continue** to open **Step ${nextPageIndex + 1} of ${totalPages}**.`];

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

export function extractModalAnswers(interaction: ModalSubmitInteraction, stepItems: NumberedQuestion[], answersMap: Map<string, string>) {
	for (const item of stepItems || []) {
		const q = item.question;
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

export function validateStepItems(stepItems: NumberedQuestion[], answersMap: Map<string, string>): string | null {
	for (const item of stepItems || []) {
		const err = validateSingleAnswer(item.question, answersMap.get(String(item.question.id)), item.displayNumber);
		if (err) return err;
	}
	return null;
}

export async function beginApplicationInteraction(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction, ws: any, positionId: string) {
	if (!interaction.guild) return;

	const [member, guildConfig, position, latestSub, draft, posCounts] = await Promise.all([
		resolveInteractionMember(interaction),
		getGuildConfig(ws, interaction.guild.id),
		ws.get('yourapps', 'forms', { id: positionId, guild: interaction.guild.id }).catch(() => null),
		ws.get('yourapps', 'submissions', { guild: interaction.guild.id, positionId, userId: interaction.user.id, latestForUser: true }).catch(() => null),
		ws.get('yourapps', 'drafts', { guild: interaction.guild.id, userId: interaction.user.id, positionId }).catch(() => null),
		ws.get('yourapps', 'submissions', { guild: interaction.guild.id, positionId, countForPosition: true }).catch(() => null),
	]);

	const check = checkApplicantEligibility({
		member,
		memberPermissions: interaction.memberPermissions,
		userId: interaction.user.id,
		userCreatedTimestamp: interaction.user.createdTimestamp,
		guildConfig,
		position,
		latestSubmission: latestSub,
		activeSubmissionCount: posCounts?.activeCount,
		approvedSubmissionCount: posCounts?.approvedCount,
	});
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

	const steps = computeDynamicModalSteps(questions, existingMap);
	const totalPages = Math.max(1, steps.length);
	const resumeStep = typeof draft?.currentStep === 'number' && draft.currentStep >= 0 && draft.currentStep < totalPages ? draft.currentStep : 0;

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
	const steps = computeDynamicModalSteps(questions, answersMap);
	const totalPages = Math.max(1, steps.length);

	for (let sIdx = 0; sIdx < steps.length; sIdx++) {
		const stepErr = validateStepItems(steps[sIdx], answersMap);
		if (stepErr) {
			await saveDraftAnswersMap(ws, interaction.guild.id, interaction.user.id, position, answersMap, sIdx).catch(() => null);
			const retryCard = buildStepContinueV2({
				position,
				nextPageIndex: sIdx,
				totalPages,
				accent,
				notice: stepErr,
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

	const activeItems = steps.flat();
	const answers = activeItems.map((item) => ({
		questionId: String(item.question.id),
		question: String(item.question.question),
		type: String(item.question.type || 'paragraph'),
		answer: (answersMap.get(String(item.question.id)) || '').trim(),
	}));

	const member = await resolveInteractionMember(interaction);
	const rolesSnapshot = getMemberRoleIds(member, interaction.guild.id);
	const joinedAtIso = isFullGuildMember(member) ? (member.joinedAt ? member.joinedAt.toISOString() : null) : (member as any)?.joined_at ? new Date((member as any).joined_at).toISOString() : null;

	const guildConfig = await getGuildConfig(ws, interaction.guild.id);
	const isAnonymous = Boolean(position.anonymousResponses);

	const created = await ws.create('yourapps', 'submissions', {
		guild: interaction.guild.id,
		positionId: position.id,
		positionName: position.name,
		userId: interaction.user.id,
		userTag: interaction.user.tag || interaction.user.username,
		userAvatar: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
		anonymous: isAnonymous,
		answers,
		applicantMeta: {
			accountCreatedAt: interaction.user.createdAt ? interaction.user.createdAt.toISOString() : null,
			guildJoinedAt: joinedAtIso,
			rolesSnapshot,
		},
	});

	if (created?.servicesDisabled) {
		const blockedCard = new ContainerBuilder()
			.setAccentColor(0xef4444)
			.addTextDisplayComponents(new TextDisplayBuilder().setContent('Submissions are unavailable while Xernerx Automatic Service Profiles are disabled on your account.'));
		await interaction.util.reply({ components: [blockedCard], display: true, ephemeral: !interaction.deferred && !interaction.replied });
		return;
	}

	// Grant On-Submit Pending Roles
	const pendingRoles: string[] = Array.isArray(position.pendingRoles) ? position.pendingRoles.map(String).filter(Boolean) : [];
	if (pendingRoles.length > 0 && !isAnonymous) {
		const fullMember = isFullGuildMember(member) ? member : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
		if (fullMember) {
			await fullMember.roles.add(pendingRoles, `YourApps: Pending submission for ${position.name}`).catch(() => null);
		}
	}

	// Auto-sync live Discord Apply Panels if maxSubmissions cap closed this position
	if (created?.formAutoClosed) {
		void syncGuildPanelsInBot(ws, interaction.guild);
	}

	const targetLogChId = String(position.logChannelOverride || guildConfig?.logChannel || '').trim();
	if (targetLogChId && created?.id) {
		try {
			const channel: any = await interaction.guild.channels.fetch(targetLogChId).catch(() => null);
			if (channel && typeof channel.send === 'function') {
				const overridePings = Array.isArray(position.submissionPingsOverride) ? position.submissionPingsOverride.map(String).filter(Boolean) : [];
				const pingRoles: string[] = overridePings.length > 0 ? overridePings : Array.isArray(guildConfig?.submissionPings) ? guildConfig.submissionPings.map(String).filter(Boolean) : [];
				const pingContent = pingRoles.length > 0 ? pingRoles.map((r) => `<@&${r}>`).join(' ') : undefined;

				const logContainer = buildSubmissionLogV2({
					guildId: interaction.guild.id,
					submission: created,
					position,
					pingContent,
					includeActions: true,
				});

				const sentMsg = await channel.send({
					components: [logContainer],
					flags: MessageFlags.IsComponentsV2,
					allowedMentions: { roles: pingRoles },
				});

				let threadId: string | null = null;
				const useThread =
					position.threadPerSubmissionOverride !== null && position.threadPerSubmissionOverride !== undefined
						? Boolean(position.threadPerSubmissionOverride)
						: Boolean(guildConfig?.threadPerSubmission);

				if (useThread && sentMsg && typeof sentMsg.startThread === 'function') {
					const applicantName = isAnonymous ? 'Anonymous' : interaction.user.username;
					const thread = await sentMsg
						.startThread({
							name: `${applicantName} • ${position.name}`.slice(0, 95),
							autoArchiveDuration: 1440,
						})
						.catch(() => null);
					if (thread?.id) threadId = String(thread.id);
				}

				let pollMessageId: string | null = null;
				const usePoll =
					position.pollOnSubmissionOverride !== null && position.pollOnSubmissionOverride !== undefined ? Boolean(position.pollOnSubmissionOverride) : Boolean(guildConfig?.pollOnSubmission);

				if (usePoll) {
					const pollTarget: any = threadId ? await interaction.guild.channels.fetch(threadId).catch(() => channel) : channel;
					if (pollTarget && typeof pollTarget.send === 'function') {
						const applicantLabel = isAnonymous ? 'this submission' : interaction.user.username;
						const duration = Math.max(1, Math.min(168, Number(guildConfig?.pollDurationHours) || 48));
						const pollMsg = await pollTarget
							.send({
								poll: {
									question: { text: `Staff Vote • ${applicantLabel} (${position.name})`.slice(0, 300) },
									answers: [
										{ text: 'Approve', emoji: '✅' },
										{ text: 'Interview', emoji: '💬' },
										{ text: 'Deny', emoji: '✖' },
									],
									duration,
									allowMultiselect: false,
								},
							})
							.catch(() => null);
						if (pollMsg?.id) pollMessageId = String(pollMsg.id);
					}
				}

				await ws
					.update('yourapps', 'submissions', {
						id: created.id,
						guild: interaction.guild.id,
						logChannelId: String(channel.id),
						logMessageId: String(sentMsg.id),
						...(threadId ? { threadId } : {}),
						...(pollMessageId ? { pollMessageId } : {}),
					})
					.catch(() => null);
			}
		} catch {
			// Do not fail applicant confirmation if log channel lacks permissions
		}
	}

	const isPollCat = position.category === 'poll';
	const confirmCard = new ContainerBuilder()
		.setAccentColor(0x22c55e)
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				isPollCat
					? `### ✅ Response Recorded!\nThank you — your response to **${position.name}** has been submitted.`
					: `### ✅ Application Submitted!\nYour application for **${position.name}** has been submitted.\n\n**Submission ID:** \`${created.id}\`\nYou can check its status, answer follow-ups, or withdraw anytime with \`/submissions\`.`
			)
		);

	await interaction.util.reply({
		components: [confirmCard],
		display: true,
		ephemeral: !interaction.deferred && !interaction.replied,
	});
}
