/** @format */

import crypto from 'node:crypto';
import { Terminal } from '@xernerx/terminal';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
	type Guild,
} from 'discord.js';
import { getAppUrl } from './endpoints.js';

export const XERNERX_ACCENT_INT = 0x8b7cf6;

const syncLogger = new Terminal({ scope: 'SYNC', spin: false });

async function collectGuildMetadata(guild: Guild, forceFetch = true) {
	const rolesCollection = forceFetch || guild.roles.cache.size === 0 ? await guild.roles.fetch().catch(() => guild.roles.cache) : guild.roles.cache;
	const serverRoles = Array.from(rolesCollection?.values?.() || [])
		.filter((r: any) => r && r.id && r.id !== guild.id && !r.managed)
		.sort((a: any, b: any) => (b.position || 0) - (a.position || 0))
		.map((r: any) => ({
			id: String(r.id),
			name: String(r.name),
			color: Number(r.color) || 0,
			position: Number(r.position) || 0,
			managed: Boolean(r.managed),
		}));

	const channelsCollection = forceFetch || guild.channels.cache.size === 0 ? await guild.channels.fetch().catch(() => guild.channels.cache) : guild.channels.cache;
	const serverChannels = Array.from(channelsCollection?.values?.() || [])
		.filter((c: any) => c && c.id && (c.type === 0 || c.type === 4 || c.type === 5 || c.type === 15))
		.sort((a: any, b: any) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0))
		.map((c: any) => ({
			id: String(c.id),
			name: String(c.name),
			type: Number(c.type) || 0,
		}));

	return { serverRoles, serverChannels };
}

export function hasGuildProfile(doc: any): boolean {
	return Boolean(doc && typeof doc === 'object' && (doc._id || doc.docId || doc.id));
}

export async function createGuildProfile(ws: any, guild: Guild, forceFetch = true) {
	if (!ws || !guild?.id) return null;
	const { serverRoles, serverChannels } = await collectGuildMetadata(guild, forceFetch);
	const created = await ws
		.create('yourapps', 'profiles', {
			id: guild.id,
			serverRoles,
			serverChannels,
		})
		.catch((err: unknown) => {
			syncLogger.warn(`Failed to create guild profile for ${guild.id}: ${(err as Error)?.message || err}`);
			return null;
		});

	if (hasGuildProfile(created)) {
		return created;
	}

	return await ws
		.update('yourapps', 'profiles', {
			id: guild.id,
			serverRoles,
			serverChannels,
		})
		.catch((err: unknown) => {
			syncLogger.warn(`Failed to upsert guild profile for ${guild.id}: ${(err as Error)?.message || err}`);
			return null;
		});
}

export async function ensureGuildProfile(ws: any, guild: Guild): Promise<{ profile: any; created: boolean }> {
	if (!ws || !guild?.id) return { profile: null, created: false };

	const existing = await ws.get('yourapps', 'profiles', { id: guild.id }).catch((err: unknown) => {
		syncLogger.warn(`Failed to check guild profile for ${guild.id}: ${(err as Error)?.message || err}`);
		return null;
	});
	if (!hasGuildProfile(existing)) {
		const profile = await createGuildProfile(ws, guild, true);
		return { profile, created: Boolean(profile) };
	}

	const profile = await syncGuildMetadata(ws, guild, true);
	return { profile: profile || existing, created: false };
}

export async function deleteGuildProfile(ws: any, guildId: string) {
	if (!ws || !guildId) return;
	await ws
		.delete('yourapps', 'profiles', {
			id: guildId,
		})
		.catch((err: unknown) => {
			syncLogger.warn(`Failed to delete guild profile for ${guildId}: ${(err as Error)?.message || err}`);
			return null;
		});
}

export async function syncGuildMetadata(ws: any, guild: Guild, forceFetch = true) {
	if (!ws || !guild?.id) return null;
	const { serverRoles, serverChannels } = await collectGuildMetadata(guild, forceFetch);

	return await ws
		.update('yourapps', 'profiles', {
			id: guild.id,
			serverRoles,
			serverChannels,
		})
		.catch((err: unknown) => {
			syncLogger.warn(`Failed to sync guild metadata for ${guild.id}: ${(err as Error)?.message || err}`);
			return null;
		});
}

export async function getGuildConfig(ws: any, guildId: string): Promise<any> {
	if (!ws || !guildId) return null;
	const doc = await ws.get('yourapps', 'profiles', { id: guildId }).catch(() => null);
	if (hasGuildProfile(doc)) return doc;
	return {
		id: guildId,
		logChannel: null,
		archiveChannel: null,
		panelChannel: null,
		submissionPings: [],
		adminRoles: [],
		reviewRoles: [],
		blacklistRoles: [],
		dmNotifications: true,
		threadPerSubmission: false,
		selfReviewAllowed: false,
		pollOnSubmission: false,
		pollDurationHours: 48,
		interviewMode: 'thread',
		interviewCategoryId: null,
		panels: [],
	};
}

function buildBotPanelPayload(guild: Guild, appUrl: string, title: string, description: string, buttonLabel: string, matched: any[]) {
	const anyOpen = matched.some((p) => p.state !== 'closed');
	const embedTitle = String(title || 'Server Applications').trim() || 'Server Applications';
	const embedDesc = String(description || '').trim() || 'Select a position below to fill out and submit your application directly inside Discord or on the web.';
	const btnText = String(buttonLabel || '').trim();
	const guildIconUrl = guild.iconURL({ extension: 'png', size: 256 });

	const container = new ContainerBuilder().setAccentColor(anyOpen ? XERNERX_ACCENT_INT : 0x64748b);
	const headerText = `### ${embedTitle.slice(0, 240)}\n${embedDesc.slice(0, 2000)}`;

	if (guildIconUrl) {
		container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText)).setThumbnailAccessory(new ThumbnailBuilder().setURL(guildIconUrl)));
	} else {
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
	}

	if (matched.length > 0) {
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

		if (matched.length <= 8) {
			for (const pos of matched) {
				const isOpen = pos.state !== 'closed';
				const posName = String(pos.name || 'Position').trim() || 'Position';
				const posDesc = String(pos.description || '').trim();
				const qCount = Array.isArray(pos.questions) ? pos.questions.length : 0;
				const isPoll = pos.category === 'poll';

				const scheduleParts: string[] = [];
				if (!isOpen && pos.opensAt) {
					const ts = Math.floor(new Date(pos.opensAt).getTime() / 1000);
					if (ts > 0) scheduleParts.push(`Opens <t:${ts}:R>`);
				}
				if (isOpen && pos.closesAt) {
					const ts = Math.floor(new Date(pos.closesAt).getTime() / 1000);
					if (ts > 0) scheduleParts.push(`Closes <t:${ts}:R>`);
				}
				const scheduleSuffix = scheduleParts.length > 0 ? ` • ${scheduleParts.join(' • ')}` : '';
				const descLine = posDesc ? `\n${posDesc.slice(0, 160)}${posDesc.length > 160 ? '…' : ''}` : '';

				const customSingleBtn = matched.length === 1 && btnText && !btnText.toLowerCase().startsWith('select a position') ? btnText.slice(0, 80) : null;
				const label = !isOpen ? 'Closed' : customSingleBtn || (isPoll ? 'Vote' : 'Apply');

				container.addSectionComponents(
					new SectionBuilder()
						.addTextDisplayComponents(
							new TextDisplayBuilder().setContent(`${isOpen ? '🟢' : '🔒'} **${posName.slice(0, 100)}** • \`${qCount} question${qCount === 1 ? '' : 's'}\`${scheduleSuffix}${descLine}`)
						)
						.setButtonAccessory(
							new ButtonBuilder()
								.setCustomId(`ya:apply:start:${pos.id}`)
								.setLabel(label)
								.setStyle(isOpen ? ButtonStyle.Primary : ButtonStyle.Secondary)
								.setDisabled(!isOpen)
						)
				);
			}
		} else {
			const listLines = matched.slice(0, 25).map((pos: any) => {
				const isOpen = pos.state !== 'closed';
				const posName = String(pos.name || 'Position').trim() || 'Position';
				const qCount = Array.isArray(pos.questions) ? pos.questions.length : 0;
				return `${isOpen ? '🟢' : '🔒'} **${posName.slice(0, 80)}** • \`${qCount} question${qCount === 1 ? '' : 's'}\``;
			});
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(listLines.join('\n').slice(0, 3800)));
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
			container.addActionRowComponents(
				new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
					new StringSelectMenuBuilder()
						.setCustomId('ya:apply:select')
						.setPlaceholder((anyOpen ? btnText || 'Select a position to apply for...' : 'All positions are currently closed').slice(0, 100))
						.setDisabled(!anyOpen)
						.addOptions(
							matched.slice(0, 25).map((pos: any) => {
								const optLabel =
									String(pos.name || 'Position')
										.replace(/\s+/g, ' ')
										.trim() || 'Position';
								const cleanPosDesc = String(pos.description || '')
									.replace(/\s+/g, ' ')
									.trim();
								const optDesc = `${pos.state === 'closed' ? '[Closed] ' : ''}${cleanPosDesc || `${Array.isArray(pos.questions) ? pos.questions.length : 0} questions`}`;
								return {
									label: optLabel.slice(0, 100),
									value: String(pos.id),
									description: optDesc.slice(0, 100),
								};
							})
						)
				)
			);
		}

		const singlePos = matched.length === 1 ? matched[0] : null;
		const webUrl = singlePos
			? `${appUrl}/servers/${encodeURIComponent(guild.id)}/applications/${encodeURIComponent(String(singlePos.id))}`
			: `${appUrl}/servers/${encodeURIComponent(guild.id)}/applications`;

		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setLabel(singlePos?.category === 'poll' ? 'Vote on Web' : 'Apply on Web')
					.setURL(webUrl)
					.setStyle(ButtonStyle.Link)
					.setDisabled(!anyOpen)
			)
		);
	}

	return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export async function syncGuildPanelsInBot(ws: any, guild: Guild): Promise<void> {
	if (!ws || !guild?.id) return;
	try {
		const [profile, formsRes] = await Promise.all([ws.get('yourapps', 'profiles', { id: guild.id }).catch(() => null), ws.get('yourapps', 'forms', { guild: guild.id }).catch(() => null)]);
		const primaryChannelId = profile?.panelChannel ? String(profile.panelChannel).trim() : '';
		const panels: any[] = Array.isArray(profile?.panels) ? profile.panels : [];
		if (panels.length === 0 && !primaryChannelId) return;

		const allPositions: any[] = extractItems(formsRes);
		const posMap = new Map<string, any>();
		for (const p of allPositions) posMap.set(String(p.id), p);

		const appUrl = getAppUrl();
		const survivingPanels: any[] = [];
		let changed = false;

		for (const panel of panels) {
			if (!panel?.channelId || !panel?.messageId) continue;
			if (panel.autoSync === false) {
				survivingPanels.push(panel);
				continue;
			}

			const targetIds: string[] = Array.isArray(panel.positionIds) ? panel.positionIds.map(String) : [];
			const matched = targetIds.length > 0 ? targetIds.map((pid) => posMap.get(pid)).filter(Boolean) : allPositions;
			const ch: any = await guild.channels.fetch(String(panel.channelId)).catch(() => null);
			const msg = ch && typeof ch.messages?.fetch === 'function' ? await ch.messages.fetch(String(panel.messageId)).catch(() => null) : null;

			if (!msg) {
				if (primaryChannelId && String(panel.channelId) === primaryChannelId && matched.length > 0 && ch && typeof ch.send === 'function') {
					const payload = buildBotPanelPayload(guild, appUrl, String(panel.title || 'Server Applications'), String(panel.description || ''), String(panel.buttonLabel || 'Apply Now'), matched);
					const sent = await ch.send(payload).catch(() => null);
					if (sent?.id) {
						survivingPanels.push({ ...panel, messageId: String(sent.id), updatedAt: new Date() });
						changed = true;
						continue;
					}
				}
				changed = true;
				continue;
			}

			if (matched.length === 0) {
				await msg.delete().catch(() => null);
				changed = true;
				continue;
			}

			const payload = buildBotPanelPayload(guild, appUrl, String(panel.title || 'Server Applications'), String(panel.description || ''), String(panel.buttonLabel || 'Apply Now'), matched);
			if (!msg.flags?.has(MessageFlags.IsComponentsV2) && ch && typeof ch.send === 'function') {
				const sent = await ch.send(payload).catch(() => null);
				if (sent?.id) {
					await msg.delete().catch(() => null);
					survivingPanels.push({ ...panel, messageId: String(sent.id), updatedAt: new Date() });
					changed = true;
					continue;
				}
			}

			await msg.edit(payload).catch(() => null);
			survivingPanels.push({ ...panel, updatedAt: new Date() });
			changed = true;
		}

		if (primaryChannelId && allPositions.length > 0 && !survivingPanels.some((p) => String(p.channelId) === primaryChannelId)) {
			const ch: any = await guild.channels.fetch(primaryChannelId).catch(() => null);
			if (ch && typeof ch.send === 'function') {
				const defaultTitle = 'Server Applications';
				const defaultDesc = 'Select a position below to fill out and submit your application directly inside Discord or on the web.';
				const defaultBtn = allPositions.length === 1 ? `Apply for ${allPositions[0].name}` : 'Select a position to apply...';
				const payload = buildBotPanelPayload(guild, appUrl, defaultTitle, defaultDesc, defaultBtn, allPositions);
				const sent = await ch.send(payload).catch(() => null);
				if (sent?.id) {
					survivingPanels.push({
						id: `pnl_${crypto.randomBytes(4).toString('hex')}`,
						channelId: primaryChannelId,
						messageId: String(sent.id),
						title: defaultTitle,
						description: defaultDesc,
						buttonLabel: defaultBtn,
						positionIds: [],
						autoSync: true,
						createdAt: new Date(),
						updatedAt: new Date(),
					});
					changed = true;
				}
			}
		}

		if (changed) {
			await ws.update('yourapps', 'profiles', { id: guild.id, panels: survivingPanels.slice(-20) }).catch(() => null);
		}
	} catch {
		// Ignore panel sync errors
	}
}

export async function resolveUserAccent(ws: any, userId: string): Promise<number> {
	if (!ws || !userId) return XERNERX_ACCENT_INT;
	try {
		const appearance = await ws.get('xernerx', 'appearance', { id: userId }).catch(() => null);
		const hex = String(appearance?.accent || '')
			.trim()
			.replace(/^#/, '');
		if (/^[0-9a-fA-F]{6}$/.test(hex)) {
			return Number.parseInt(hex, 16);
		}
	} catch {
		// Fall back to default brand accent
	}
	return XERNERX_ACCENT_INT;
}

export function extractItems<T = any>(res: any): T[] {
	if (!res) return [];
	if (Array.isArray(res)) return res;
	if (Array.isArray(res.items)) return res.items;
	return Object.entries(res)
		.filter(([k]) => /^\d+$/.test(k))
		.map(([, v]) => v as T);
}
